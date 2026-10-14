import SwiftUI

extension View {
    /// Runs `perform` on the main actor for each typed `NotificationCenter` message while the view is on screen,
    /// synchronously as it is posted, which keyboard and time-change messages rely on.
    func onMessage<Identifier, Message>(
        of subject: Message.Subject.Type,
        for identifier: Identifier,
        perform: @escaping @MainActor (Message) -> Void
    ) -> some View where Identifier: NotificationCenter.MessageIdentifier, Message: NotificationCenter.MainActorMessage,
        Message == Identifier.MessageType {
        modifier(MessageObserver { NotificationCenter.default.addObserver(of: subject, for: identifier, using: perform) })
    }
}

private struct MessageObserver: ViewModifier {
    let observe: @MainActor () -> NotificationCenter.ObservationToken
    @State private var token: NotificationCenter.ObservationToken?

    func body(content: Content) -> some View {
        content
            .onAppear { token = token ?? observe() }
            .onDisappear {
                if let token { NotificationCenter.default.removeObserver(token) }
                token = nil
            }
    }
}
