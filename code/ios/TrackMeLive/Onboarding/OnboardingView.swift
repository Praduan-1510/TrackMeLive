import SwiftUI
import TMLCore

/// Onboarding: three short pages, then sign-up (not built yet; for now it lands on Home).
/// Matches the prototype's iPhone screens: Skip top right, the art, a Gabarito title, a line of
/// body text, page dots and a prominent Continue.
struct OnboardingView: View {
    @Environment(AppModel.self) private var model
    @State private var page = 0

    private let pages = OnboardingPage.allCases

    private var isLast: Bool { page == pages.count - 1 }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Spacer()
                PlainInkButton("Skip") { model.finishOnboarding() }
                    .opacity(isLast ? 0 : 1)
                    .disabled(isLast)
                    .accessibilityHidden(isLast)
            }
            .frame(minHeight: TMLSpacing.tapTarget)

            TabView(selection: $page) {
                ForEach(pages) { item in
                    OnboardingPageView(page: item)
                        .tag(item.rawValue)
                }
            }
            .tabViewStyle(.page(indexDisplayMode: .never))

            PageDots(count: pages.count, current: page)
                .padding(.top, TMLSpacing.space4)

            PrimaryButton(isLast ? "Get started" : "Continue") {
                if isLast {
                    model.finishOnboarding()
                } else {
                    withAnimation(.smooth) { page += 1 }
                }
            }
            .padding(.top, TMLSpacing.space5)
            .padding(.bottom, TMLSpacing.space2)
        }
        .screenMargins()
        .background(TMLColor.ground)
        .tint(TMLColor.ink)
    }
}

enum OnboardingPage: Int, CaseIterable, Identifiable {
    case share, together, privacy

    var id: Int { rawValue }

    var title: LocalizedStringKey {
        switch self {
        case .share: "Share where you are, the moment you\u{2019}re on the phone."
        case .together: "Live Together"
        case .privacy: "Private by default"
        }
    }

    var body: LocalizedStringKey? {
        switch self {
        case .share: "One tap during a call, and the person you\u{2019}re talking to can follow you live. They don\u{2019}t need the app."
        case .together: "While you talk, they can share back. You both see one map until the call ends."
        case .privacy: nil
        }
    }
}

private struct OnboardingPageView: View {
    let page: OnboardingPage
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    /// The art gives way to the words at the accessibility text sizes.
    private var artHeight: CGFloat { dynamicTypeSize.isAccessibilitySize ? 200 : 330 }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                art
                    .frame(maxWidth: .infinity)
                    .frame(height: artHeight)

                Text(page.title)
                    .displayFont(.title1)
                    .foregroundStyle(TMLColor.ink)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityAddTraits(.isHeader)

                if let body = page.body {
                    Text(body)
                        .font(.body)
                        .foregroundStyle(TMLColor.inkSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.top, TMLSpacing.space3)
                }

                if page == .privacy {
                    PrivacyPoints()
                        .padding(.top, TMLSpacing.space5)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .scrollBounceBehavior(.basedOnSize)
        .scrollIndicators(.hidden)
    }

    @ViewBuilder private var art: some View {
        let scale = artHeight / 330
        switch page {
        case .share:
            // Fox, the default mascot, on its halo: 250pt on a 300pt glow, gently bobbing.
            MascotArt(mascot: .fox, size: 250 * scale, haloScale: 1.2, bobs: true)
        case .together:
            LiveTogetherArt()
                .frame(width: 330 * scale, height: 280 * scale)
        case .privacy:
            ZStack {
                Circle().fill(TMLColor.lamplightHalo).frame(width: 300 * scale, height: 300 * scale)
                Image("brand-mark")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 150 * scale)
            }
            .accessibilityHidden(true)
        }
    }
}

private struct PrivacyPoints: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TMLSpacing.space4) {
            point("checkmark.shield", "Nothing is shared until you tap Share.")
            point("clock", "Sharing stops when the call ends, or when your timer runs out.")
            point("trash", "Location points are deleted 24 hours after you stop.")
        }
    }

    private func point(_ symbol: String, _ text: LocalizedStringKey) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: TMLSpacing.space3) {
            Image(systemName: symbol)
                .symbolRenderingMode(.hierarchical)
                .foregroundStyle(TMLColor.lamplightText)
                .accessibilityHidden(true)
            Text(text)
                .font(.callout)
                .foregroundStyle(TMLColor.ink)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

/// Page dots: the current page is a 24pt lamplight capsule. Hidden from VoiceOver, which hears
/// the page as "Page 1 of 3" from the pager instead.
private struct PageDots: View {
    let count: Int
    let current: Int
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        HStack(spacing: TMLSpacing.space2) {
            ForEach(0..<count, id: \.self) { index in
                Capsule()
                    .fill(index == current ? TMLColor.lamplight : TMLColor.inkTertiary.opacity(0.35))
                    .frame(width: index == current ? 24 : 8, height: 8)
            }
        }
        .animation(reduceMotion ? nil : .smooth(duration: 0.3), value: current)
        .accessibilityElement()
        .accessibilityLabel("Page \(current + 1) of \(count)")
    }
}

/// Onboarding page 2: a small night-street map with the sharer's marker (their mascot on a
/// lamplight ring) and the viewer's (a crossing disc with their initial), joined by the dashed line.
private struct LiveTogetherArt: View {
    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width, h = geo.size.height
            let sharer = CGPoint(x: w * 0.38, y: h * 0.80)
            let viewer = CGPoint(x: w * 0.69, y: h * 0.22)
            ZStack {
                TMLColor.mapLand
                // A park and a corner of water.
                Rectangle().fill(TMLColor.mapPark).frame(width: w * 0.28, height: h * 0.16)
                    .position(x: w * 0.72, y: h * 0.98)
                Rectangle().fill(TMLColor.mapPark).frame(width: w * 0.06, height: h * 0.3)
                    .position(x: 0, y: h * 0.38)
                // Minor streets.
                Path { p in
                    p.move(to: CGPoint(x: w * 0.36, y: 0)); p.addLine(to: CGPoint(x: w * 0.40, y: h))
                    p.move(to: CGPoint(x: w * 0.74, y: 0)); p.addLine(to: CGPoint(x: w * 0.76, y: h))
                    p.move(to: CGPoint(x: 0, y: h * 0.72)); p.addLine(to: CGPoint(x: w, y: h * 0.64))
                }
                .stroke(TMLColor.mapRoad, lineWidth: 9)
                // The main road, warm like a street under sodium lights.
                Path { p in
                    p.move(to: CGPoint(x: w * 0.18, y: h * 1.02))
                    p.addQuadCurve(to: CGPoint(x: w * 1.02, y: h * 0.18), control: CGPoint(x: w * 0.55, y: h * 0.55))
                }
                .stroke(TMLColor.mapRoadMajor, lineWidth: 14)

                Path { p in p.move(to: sharer); p.addLine(to: viewer) }
                    .stroke(TMLColor.ink.opacity(0.6), style: StrokeStyle(lineWidth: 2, lineCap: .round, dash: [5, 6]))

                ViewerMarker(initial: "M").position(viewer)
                SharerMarker(mascot: .fox).position(sharer)
            }
        }
        .clipShape(.rect(cornerRadius: 32, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 32, style: .continuous).strokeBorder(TMLColor.separator, lineWidth: 1)
        }
        .accessibilityHidden(true)
    }
}

/// The sharer's marker: a 52pt surface disc with a 3pt lamplight ring, the mascot at 40pt, an
/// 80pt halo, and a 1pt keyline outside the ring (on-lamplight in light, ground in dark).
struct SharerMarker: View {
    let mascot: Mascot
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        ZStack {
            Circle().fill(TMLColor.lamplightHalo).frame(width: 80, height: 80)
            Circle()
                .fill(TMLColor.surface)
                .overlay(Circle().strokeBorder(TMLColor.lamplight, lineWidth: 3))
                .overlay(Circle().stroke(colorScheme == .dark ? TMLColor.ground : TMLColor.onLamplight, lineWidth: 1).padding(-0.5))
                .frame(width: 52, height: 52)
                .tmlShadow(.marker, colorScheme: colorScheme)
            Image(mascot.renderAssetName).resizable().scaledToFit().frame(width: 40, height: 40)
        }
    }
}

/// The viewer's marker on the sharer's map: a 48pt crossing disc with the initial of the name the
/// sharer gave (a person icon without one), a 3pt surface ring and a 72pt crossing halo.
struct ViewerMarker: View {
    var initial: String?
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        ZStack {
            Circle().fill(TMLColor.crossingHalo).frame(width: 72, height: 72)
            Circle()
                .fill(TMLColor.crossing)
                .overlay(Circle().strokeBorder(TMLColor.surface, lineWidth: 3))
                .frame(width: 48, height: 48)
                .tmlShadow(.marker, colorScheme: colorScheme)
            Group {
                if let initial {
                    // Markers keep their size at every text size, so the initial is fixed too.
                    Text(initial).font(Font(Gabarito.ctFont(size: 18, weight: 700)))
                } else {
                    Image(systemName: "person.fill").font(.system(size: 17, weight: .semibold))
                }
            }
            .foregroundStyle(TMLColor.onCrossing)
        }
    }
}

#Preview("Onboarding") {
    OnboardingView().environment(AppModel(defaults: UserDefaults(suiteName: "preview")!))
}
