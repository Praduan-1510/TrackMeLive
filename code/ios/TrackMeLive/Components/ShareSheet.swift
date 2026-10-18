import LinkPresentation
import SwiftUI
import TMLCore
import UIKit

// The system share sheet with the session's link (FSD §4 Live map link): Messages, WhatsApp, Mail,
// Copy link. The app never sends anything itself. SwiftUI's ShareLink can't say how the sheet
// closed, and the share screen must know (closing without a choice discards the session), so this
// presents UIKit's UIActivityViewController and reports `ShareSheetOutcome`.
//
//     .shareSheet(item: $model.shareSheet) { outcome in Task { await model.shareSheetClosed(outcome) } }

extension View {
    /// Presents the system share sheet while `item` is set, and calls `onClose` once when it goes
    /// away: sent (Copy link counts) or cancelled. Setting `item` to nil from outside dismisses it
    /// without calling `onClose`.
    func shareSheet(item: Binding<ShareLinkMessage?>, onClose: @escaping @MainActor (ShareSheetOutcome) -> Void) -> some View {
        background(ShareSheetPresenter(item: item, onClose: onClose).accessibilityHidden(true))
    }
}

private struct ShareSheetPresenter: UIViewControllerRepresentable {
    @Binding var item: ShareLinkMessage?
    let onClose: @MainActor (ShareSheetOutcome) -> Void

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIViewController(context: Context) -> UIViewController {
        let host = UIViewController()
        host.view.isUserInteractionEnabled = false
        return host
    }

    func updateUIViewController(_ host: UIViewController, context: Context) {
        let coordinator = context.coordinator
        coordinator.onClose = onClose
        if let item {
            coordinator.present(item, from: host)
        } else {
            coordinator.dismissQuietly()
        }
    }

    static func dismantleUIViewController(_ host: UIViewController, coordinator: Coordinator) {
        coordinator.dismissQuietly()
    }

    @MainActor
    final class Coordinator {
        var onClose: (@MainActor (ShareSheetOutcome) -> Void)?
        private var controller: UIActivityViewController?
        private var shown: ShareLinkMessage?

        func present(_ item: ShareLinkMessage, from host: UIViewController) {
            guard shown != item else { return }
            // Not in a window yet (the first update of a new screen): try again on the next turn.
            guard let window = host.view.window else {
                Task { @MainActor [weak self, weak host] in
                    guard let self, let host, host.view.window != nil else { return }
                    self.present(item, from: host)
                }
                return
            }
            shown = item
            let controller = UIActivityViewController(activityItems: [MessageItem(item), LinkItem(item)],
                                                      applicationActivities: nil)
            controller.completionWithItemsHandler = { [weak self, weak controller] type, completed, _, _ in
                MainActor.assumeIsolated {
                    guard let self, let controller else { return }
                    self.finished(controller, type: type, completed: completed)
                }
            }
            // iPad and Mac show it as a popover; the iPhone ignores this.
            controller.popoverPresentationController?.sourceView = host.view
            self.controller = controller
            Self.topmost(from: window.rootViewController)?.present(controller, animated: true)
        }

        /// The model cleared the item (the share ended): close without reporting.
        func dismissQuietly() {
            guard let controller else { return }
            self.controller = nil
            shown = nil
            controller.presentingViewController?.dismiss(animated: true)
        }

        private func finished(_ controller: UIActivityViewController, type: UIActivity.ActivityType?, completed: Bool) {
            guard controller === self.controller else { return }
            if completed {
                report(.sent(copied: type == .copyToPasteboard))
                return
            }
            // Cancelling a chosen app (Messages' composer) can leave the sheet up for another choice;
            // only a sheet that has gone away counts as closed without a choice.
            Task { @MainActor [weak self, weak controller] in
                guard let self, let controller, controller === self.controller,
                      controller.presentingViewController == nil else { return }
                self.report(.cancelled)
            }
        }

        private func report(_ outcome: ShareSheetOutcome) {
            controller = nil
            shown = nil
            onClose?(outcome)
        }

        /// The view controller on top, which is the one that can present.
        private static func topmost(from root: UIViewController?) -> UIViewController? {
            var top = root
            while let presented = top?.presentedViewController, !presented.isBeingDismissed {
                top = presented
            }
            return top
        }
    }
}

/// The line of text. Copy link copies only the link, so this sits out of the clipboard.
private final class MessageItem: NSObject, UIActivityItemSource {
    let message: ShareLinkMessage

    init(_ message: ShareLinkMessage) { self.message = message }

    func activityViewControllerPlaceholderItem(_ activityViewController: UIActivityViewController) -> Any {
        message.text
    }

    func activityViewController(_ activityViewController: UIActivityViewController,
                                itemForActivityType activityType: UIActivity.ActivityType?) -> Any? {
        activityType == .copyToPasteboard ? nil : message.text
    }

    func activityViewController(_ activityViewController: UIActivityViewController,
                                subjectForActivityType activityType: UIActivity.ActivityType?) -> String {
        message.previewTitle
    }
}

/// The link, with the sheet's header: "Alex · Live location" and the app icon.
private final class LinkItem: NSObject, UIActivityItemSource {
    let message: ShareLinkMessage

    init(_ message: ShareLinkMessage) { self.message = message }

    func activityViewControllerPlaceholderItem(_ activityViewController: UIActivityViewController) -> Any {
        message.url
    }

    func activityViewController(_ activityViewController: UIActivityViewController,
                                itemForActivityType activityType: UIActivity.ActivityType?) -> Any? {
        message.url
    }

    func activityViewControllerLinkMetadata(_ activityViewController: UIActivityViewController) -> LPLinkMetadata? {
        let metadata = LPLinkMetadata()
        metadata.title = message.previewTitle
        metadata.originalURL = message.url
        metadata.url = message.url
        if let icon = UIImage(named: "brand-mark") {
            metadata.iconProvider = NSItemProvider(object: icon)
        }
        return metadata
    }
}
