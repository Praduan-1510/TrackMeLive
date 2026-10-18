import ActivityKit
import SwiftUI
import TMLCore
import WidgetKit

/// The share session's Live Activity: the Lock Screen and the Dynamic Island while the sharer is
/// out of the app (FSD "In-call mini map" on iOS; prototype `island()`).
///
/// Sprint 0 skeleton: the layout and the words are in place and read from `ContentState`; the app
/// starts, updates and ends it once sessions exist.
/// - Compact: the mascot (flat SVG, at 20pt the renders lose their features) and the distance, or
///   "Live" until the viewer shares back.
/// - Expanded: who it's with, when it stops, both people and the distance, Open map and Stop sharing
///   (which opens the app to confirm).
struct ShareLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: ShareActivityAttributes.self) { context in
            LockScreenView(attributes: context.attributes, state: context.state)
                .activitySystemActionForegroundColor(TMLColor.ink)
                .widgetURL(TMLCore.Route.live.url)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Image(context.attributes.mascot.renderAssetName)
                        .resizable()
                        .scaledToFit()
                        .frame(width: 44, height: 44)
                        .opacity(context.state.signal == .live ? 1 : 0.55)
                        .accessibilityHidden(true)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    StatusBadge(state: context.state)
                }
                DynamicIslandExpandedRegion(.center) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(context.attributes.sharingWithLine)
                            .font(.headline)
                            .foregroundStyle(Island.ink)
                        Text(Lines.sub(context.attributes, context.state))
                            .font(.subheadline)
                            .monospacedDigit()
                            .foregroundStyle(Island.inkSecondary)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(spacing: TMLSpacing.space3) {
                        Text(Lines.together(context.attributes, context.state))
                            .font(.subheadline.weight(.semibold))
                            .monospacedDigit()
                            .foregroundStyle(Island.ink)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        HStack(spacing: TMLSpacing.space2) {
                            Link(destination: TMLCore.Route.live.url) {
                                Text("Open map")
                                    .frame(maxWidth: .infinity, minHeight: TMLSpacing.tapTarget)
                                    .background(Island.surfaceRaised, in: .capsule)
                                    .foregroundStyle(Island.ink)
                            }
                            Link(destination: TMLCore.Route.stop.url) {
                                Text("Stop sharing")
                                    .frame(maxWidth: .infinity, minHeight: TMLSpacing.tapTarget)
                                    .background(Island.flareWash, in: .capsule)
                                    .foregroundStyle(Island.flareText)
                            }
                        }
                        .font(.subheadline.weight(.semibold))
                    }
                }
            } compactLeading: {
                Image(context.attributes.mascot.flatAssetName)
                    .resizable()
                    .scaledToFit()
                    .frame(width: 20, height: 20)
                    .accessibilityHidden(true)
            } compactTrailing: {
                Text(Lines.short(context.attributes, context.state))
                    .font(.caption.weight(.semibold))
                    .monospacedDigit()
                    .foregroundStyle(context.state.signal == .live ? Island.lamplightText : Island.inkSecondary)
            } minimal: {
                Image(context.attributes.mascot.flatAssetName)
                    .resizable()
                    .scaledToFit()
                    .frame(width: 20, height: 20)
                    .accessibilityLabel(context.attributes.sharingWithLine)
            }
            .widgetURL(TMLCore.Route.live.url)
            .keylineTint(Island.lamplight)
        }
    }
}

/// The Dynamic Island is hardware black, so it always takes the dark tokens.
private enum Island {
    static let ink = Color(tml: TMLColorToken.ink.dark)
    static let inkSecondary = Color(tml: TMLColorToken.inkSecondary.dark)
    static let surfaceRaised = Color(tml: TMLColorToken.surfaceRaised.dark)
    static let lamplight = Color(tml: TMLColorToken.lamplight.dark)
    static let lamplightText = Color(tml: TMLColorToken.lamplightText.dark)
    static let lamplightWash = Color(tml: TMLColorToken.lamplightWash.dark)
    static let flareText = Color(tml: TMLColorToken.flareText.dark)
    static let flareWash = Color(tml: TMLColorToken.flareWash.dark)
}

/// The words, shared by the Lock Screen and the island (prototype `islandShort` / `islandSub`).
private enum Lines {
    static func distance(_ state: ShareActivityAttributes.ContentState) -> DistanceText? {
        state.distanceMeters.map {
            DistanceText(meters: $0, units: .init(locale: .current), approximate: state.approximate)
        }
    }

    /// Compact trailing: the distance once they share back, else Live; or what went wrong.
    static func short(_ attributes: ShareActivityAttributes, _ state: ShareActivityAttributes.ContentState) -> String {
        switch state.signal {
        case .noConnection: "No connection"
        case .noSignal: "No signal"
        case .live: distance(state)?.short ?? "Live"
        }
    }

    /// Under the name: when it stops, the 1-hour warning, or the last-seen time.
    static func sub(_ attributes: ShareActivityAttributes, _ state: ShareActivityAttributes.ContentState) -> String {
        let time = Date.FormatStyle(date: .omitted, time: .shortened)
        switch state.signal {
        case .noSignal: return "No signal · last seen \(state.lastPingAt.formatted(time))"
        case .noConnection: return "No connection · last seen \(state.lastPingAt.formatted(time))"
        case .live: break
        }
        if attributes.showsLimitWarning(at: .now) {
            return "Sharing stops at \(attributes.expiresAt.formatted(time)) · 1-hour limit"
        }
        guard let stopsAt = attributes.stopsAt(state) else { return "Until the call ends" }
        return "Until \(stopsAt.formatted(time))"
    }

    /// Both people: the distance apart, or the viewer's status until they share back.
    static func together(_ attributes: ShareActivityAttributes, _ state: ShareActivityAttributes.ContentState) -> String {
        if state.viewerSharing, let d = distance(state) { return "\(d.short) apart" }
        return attributes.viewerStatusLine(state)
    }
}

/// LIVE in lamplight, or the word for what went wrong. Never color alone.
private struct StatusBadge: View {
    let state: ShareActivityAttributes.ContentState

    var body: some View {
        let live = state.signal == .live
        HStack(spacing: TMLSpacing.space1) {
            if live { Circle().fill(Island.lamplight).frame(width: 6, height: 6) }
            Text(badge)
                .displayFont(.badge)
        }
        .padding(.horizontal, TMLSpacing.space2)
        .frame(minHeight: 22)
        .background(live ? Island.lamplightWash : Island.surfaceRaised, in: .capsule)
        .foregroundStyle(live ? Island.lamplightText : Island.inkSecondary)
    }

    private var badge: String {
        switch state.signal {
        case .live: state.viewerSharing ? "Live together" : "Live"
        case .noSignal: "No signal"
        case .noConnection: "No connection"
        }
    }
}

/// The Lock Screen (and Notification Center) presentation, on the system's own material.
private struct LockScreenView: View {
    let attributes: ShareActivityAttributes
    let state: ShareActivityAttributes.ContentState

    var body: some View {
        HStack(spacing: TMLSpacing.space3) {
            ZStack {
                Circle().fill(TMLColor.lamplightHalo).frame(width: 52, height: 52)
                Image(attributes.mascot.renderAssetName)
                    .resizable()
                    .scaledToFit()
                    .frame(width: 44, height: 44)
                    .opacity(state.signal == .live ? 1 : 0.55)
            }
            .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 2) {
                Text(attributes.sharingWithLine)
                    .font(.headline)
                    .foregroundStyle(TMLColor.ink)
                Text(Lines.sub(attributes, state))
                    .font(.subheadline)
                    .monospacedDigit()
                    .foregroundStyle(TMLColor.inkSecondary)
                Text(Lines.together(attributes, state))
                    .font(.subheadline)
                    .monospacedDigit()
                    .foregroundStyle(TMLColor.inkSecondary)
            }
            Spacer(minLength: 0)
            if state.viewerSharing, let d = Lines.distance(state) {
                Text(d.short)
                    .displayFont(.distance)
                    .monospacedDigit()
                    .foregroundStyle(TMLColor.ink)
                    .accessibilityLabel("\(d.spoken) apart")
            }
        }
        .padding(TMLSpacing.space4)
    }
}

// MARK: - Previews

extension ShareActivityAttributes {
    fileprivate static var preview: ShareActivityAttributes {
        let start = Date.now.addingTimeInterval(-12 * 60)
        return ShareActivityAttributes(sessionID: "preview", mascot: .fox, viewerName: "Mom",
                                       startedAt: start, expiresAt: start.addingTimeInterval(3600))
    }
}

extension ShareActivityAttributes.ContentState {
    fileprivate static let waiting = Self(lastPingAt: .now)
    fileprivate static let watching = Self(lastPingAt: .now, viewerOpenedAt: .now)
    fileprivate static let together = Self(lastPingAt: .now, viewerOpenedAt: .now, viewerSharing: true, distanceMeters: 1_234)
    fileprivate static let noSignal = Self(signal: .noSignal, lastPingAt: .now.addingTimeInterval(-90), viewerOpenedAt: .now)
}

#Preview("Lock Screen", as: .content, using: ShareActivityAttributes.preview) {
    ShareLiveActivity()
} contentStates: {
    ShareActivityAttributes.ContentState.waiting
    ShareActivityAttributes.ContentState.together
    ShareActivityAttributes.ContentState.noSignal
}

#Preview("Island compact", as: .dynamicIsland(.compact), using: ShareActivityAttributes.preview) {
    ShareLiveActivity()
} contentStates: {
    ShareActivityAttributes.ContentState.watching
    ShareActivityAttributes.ContentState.together
}

#Preview("Island expanded", as: .dynamicIsland(.expanded), using: ShareActivityAttributes.preview) {
    ShareLiveActivity()
} contentStates: {
    ShareActivityAttributes.ContentState.watching
    ShareActivityAttributes.ContentState.together
    ShareActivityAttributes.ContentState.noSignal
}
