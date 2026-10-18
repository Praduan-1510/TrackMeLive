import Foundation
import Observation

/// Onboarding (prototype `viewOnboarding`): three pages, Skip on the first two, page dots, and
/// Continue, then Get started on the last page. Skip and Get started both lead to sign-up.
@Observable
@MainActor
public final class OnboardingModel {
    public enum Page: Int, CaseIterable, Identifiable, Hashable, Sendable {
        /// "Share where you are, the moment you're on the phone."
        case share
        /// "Live Together"
        case together
        /// "Private by default"
        case privacy

        public var id: Int { rawValue }
    }

    /// The page on screen. The pager binds to it, so a swipe moves it too.
    public var page: Page

    @ObservationIgnored private let onFinished: @MainActor () -> Void

    /// - Parameter page: where to start; Back from sign-up returns to the last page.
    public init(page: Page = .share, onFinished: @escaping @MainActor () -> Void) {
        self.page = page
        self.onFinished = onFinished
    }

    public var pageCount: Int { Page.allCases.count }
    public var isLastPage: Bool { page == Page.allCases.last }
    /// Skip shows on every page but the last, where Get started does the same.
    public var showsSkip: Bool { !isLastPage }

    public var continueTitle: String {
        isLastPage
            ? String(localized: "Get started", bundle: .module)
            : String(localized: "Continue", bundle: .module)
    }

    /// "Page 2 of 3", for VoiceOver on the page dots.
    public var pagePosition: String {
        String(localized: "Page \(page.rawValue + 1) of \(pageCount)", bundle: .module)
    }

    /// Continue: the next page, or sign-up from the last.
    public func advance() {
        if let next = Page(rawValue: page.rawValue + 1) {
            page = next
        } else {
            onFinished()
        }
    }

    public func skip() {
        onFinished()
    }
}
