import Core
import SwiftUI

extension EnvironmentValues {
    /// The namespace the viewer zooms out of and back into, set by the details sheet that presents it.
    @Entry var imageZoom: Namespace.ID?
}

extension View {
    /// A thumbnail the viewer zooms out of. The zoom transition is also what lets a swipe down close the viewer.
    @ViewBuilder
    func zoomSource(_ imageID: String, in zoom: Namespace.ID?) -> some View {
        if let zoom {
            matchedTransitionSource(id: imageID, in: zoom) { $0.clipShape(.rect(cornerRadius: 16)) }
        } else {
            self
        }
    }
}

/// A task's images full screen, swiped through like Photos, pinched to zoom, swiped down to close, with delete on an
/// editable task.
struct ImageViewer: View {
    @Environment(TaskImages.self) private var images
    @Environment(Store.self) private var store
    @Environment(\.dismiss) private var dismiss
    let start: TaskImages.Viewing

    @State private var current: String

    init(start: TaskImages.Viewing) {
        self.start = start
        _current = State(initialValue: start.imageID)
    }

    var body: some View {
        let task = store.task(start.taskID)
        let list = task?.images ?? []
        let index = list.firstIndex { $0.id == current }
        ZStack(alignment: .top) {
            Color.black.ignoresSafeArea()
            TabView(selection: $current) {
                ForEach(list) { image in
                    ZoomableImage(image: image).tag(image.id)
                }
            }
            .tabViewStyle(.page(indexDisplayMode: .never))
            .ignoresSafeArea()
            HStack {
                if let index, list.count > 1 {
                    Text("\(index + 1) of \(list.count)")
                        .font(.subheadline.monospacedDigit())
                        .foregroundStyle(.white.opacity(0.75))
                }
                Spacer()
                if let task, !store.isReadOnly(task.id) {
                    Button("Delete image", systemImage: "trash") { images.remove(task.id, current) }
                        .labelStyle(.iconOnly)
                        .buttonStyle(.glass)
                }
                Button("Close image", systemImage: "xmark") { dismiss() }
                    .labelStyle(.iconOnly)
                    .buttonStyle(.glass)
            }
            .padding(.horizontal, 20)
            .padding(.top, 8)
        }
        .environment(\.colorScheme, .dark)
        .onChange(of: list) {
            if list.isEmpty { dismiss() } else if !list.contains(where: { $0.id == current }) { current = list[0].id }
        }
    }
}

private struct ZoomableImage: View {
    let image: ImageRef
    @State private var zoom: CGFloat = 1
    @GestureState private var pinch: CGFloat = 1

    var body: some View {
        ImageThumb(image: image, size: .full)
            .scaleEffect(zoom * pinch)
            .gesture(
                MagnifyGesture()
                    .updating($pinch) { value, state, _ in state = value.magnification }
                    .onEnded { value in withAnimation(.snappy) { zoom = min(max(zoom * value.magnification, 1), 4) } }
            )
            .onTapGesture(count: 2) { withAnimation(.snappy) { zoom = zoom > 1 ? 1 : 2.5 } }
            .padding(.vertical, 60)
            .accessibilityLabel("Image")
    }
}
