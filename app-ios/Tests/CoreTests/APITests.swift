import Core
import Foundation
import Testing

@Suite struct APITests {
    private func roundTrip<T: Codable>(_: T.Type, _ json: String) throws -> [String: Any] {
        let decoded = try JSONDecoder().decode(T.self, from: Data(json.utf8))
        let encoded = try JSONEncoder().encode(decoded)
        return try #require(JSONSerialization.jsonObject(with: encoded) as? [String: Any])
    }

    @Test func aPatchKeepsNullApartFromMissing() throws {
        let op = try roundTrip(API.Op.self, #"{"kind":"task","id":"t1","opId":"op-1","hlc":"1:0:d","fields":{"due":null,"title":"Milk"}}"#)
        let fields = try #require(op["fields"] as? [String: Any])
        #expect(op["kind"] as? String == "task")
        #expect(fields["due"] is NSNull)
        #expect(fields["title"] as? String == "Milk")
        #expect(fields["completedAt"] == nil)
    }

    @Test func aResponseDecodesTheSnapshotOrTheChanges() throws {
        let snapshot = try JSONDecoder().decode(
            API.SyncResponse.self,
            from: Data(#"{"acked":[],"cursor":0,"hlc":"1:0:server","epoch":0,"snapshot":{"tasks":[],"projects":[],"sections":[],"labels":[],"settings":{"timeZone":null,"dictation":"native"}}}"#.utf8)
        )
        guard case .snapshot = snapshot else { Issue.record("expected a snapshot"); return }
        let changes = try JSONDecoder().decode(
            API.SyncResponse.self,
            from: Data(#"{"acked":["op-1"],"cursor":3,"hlc":"1:0:server","epoch":0,"changes":[{"seq":3,"opId":"op-1","kind":"label","id":"l1","fields":{"name":"Home"}}]}"#.utf8)
        )
        guard case let .changes(page) = changes else { Issue.record("expected changes"); return }
        #expect(page.changes.count == 1)
    }

    @Test func theOutboxIsAContractRequest() throws {
        var snapshot = Snapshot.empty(now: 0)
        SyncEngine.ensure(&snapshot, deviceId: "device-1234", now: 0, timeZone: "UTC") { "op-1" }
        let request = try #require(try SyncEngine.request(snapshot))
        #expect(request.cursor == 0)
        #expect(request.ops.count == 1)
        guard case let .settings(op) = request.ops.first else { Issue.record("expected the settings op"); return }
        #expect(op.fields.timeZone == .some("UTC"))
    }

    @Test func anOutboxFromTheBooleanBugStillSends() throws {
        var snapshot = Snapshot.empty(now: 0)
        SyncEngine.ensure(&snapshot, deviceId: "device-1234", now: 0, timeZone: "UTC") { "op-1" }
        snapshot.sync?.outbox.append(SyncOp(opId: "op-2", hlc: "1:0:device-1234", kind: .task, id: "t1", fields: [
            "order": .bool(false),
            "priority": .bool(true),
            "recurrence": .object(["interval": .bool(true), "unit": .string("week"), "days": .array([.bool(true), .number(3)])]),
            "reminders": .array([.object(["kind": .string("before"), "minutes": .bool(false)])]),
        ]))
        let request = try #require(try SyncEngine.request(snapshot))
        guard case let .task(op) = request.ops.last else { Issue.record("expected the task op"); return }
        #expect(op.fields.order == 0)
        #expect(op.fields.priority == .p1)
    }

    @Test func aOneCharacterHighlightDecodes() throws {
        let highlight = try JSONDecoder.validating().decode(Search.Highlight.self, from: Data(#"{"text":"a","ranges":[[0,1]]}"#.utf8))
        #expect(highlight.ranges == [0..<1])
    }

    @Test func anOptionalFieldRejectsNullLikeZod() {
        let json = #"{"id":"p","name":"Home","createdAt":1,"sourceKey":null}"#
        #expect(throws: DecodingError.self) { try JSONDecoder().decode(Project.self, from: Data(json.utf8)) }
    }
}
