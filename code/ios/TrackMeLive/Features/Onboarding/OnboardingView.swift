import SwiftUI
import TMLCore

/// Onboarding (prototype `viewOnboarding`): three short pages, then sign-up. Skip top right on the
/// first two, the art, a Gabarito title, a line of body text, page dots and a prominent Continue
/// (Get started on the last page). Swiping between pages works too. The logic is `OnboardingModel`.
struct OnboardingView: View {
    @Bindable var model: OnboardingModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Spacer()
                PlainInkButton("Skip") { model.skip() }
                    .opacity(model.showsSkip ? 1 : 0)
                    .disabled(!model.showsSkip)
                    .accessibilityHidden(!model.showsSkip)
            }
            .frame(minHeight: TMLSpacing.tapTarget)

            TabView(selection: $model.page) {
                ForEach(OnboardingModel.Page.allCases) { page in
                    OnboardingPageView(page: page)
                        .tag(page)
                }
            }
            .tabViewStyle(.page(indexDisplayMode: .never))

            PageDots(count: model.pageCount, current: model.page.rawValue, label: model.pagePosition)
                .padding(.top, TMLSpacing.space4)

            Button {
                withAnimation(reduceMotion ? nil : .smooth) { model.advance() }
            } label: {
                Text(verbatim: model.continueTitle)
            }
            .buttonStyle(.tmlProminent)
            .padding(.top, TMLSpacing.space5)
            .padding(.bottom, TMLSpacing.space2)
        }
        .screenMargins()
        .background(TMLColor.ground)
        .tint(TMLColor.ink)
    }
}

extension OnboardingModel.Page {
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
    let page: OnboardingModel.Page
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
            // Fox, everyone's mascot until they pick one, on its halo: 250pt on a 300pt glow, gently bobbing.
            MascotArt(look: .default, size: 250 * scale, haloScale: 1.2, bobs: true)
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

/// Page dots: the current page is a 24pt lamplight capsule. VoiceOver reads them as one element,
/// "Page 2 of 3"; the pager itself can be swiped.
private struct PageDots: View {
    let count: Int
    let current: Int
    let label: String
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
        .accessibilityLabel(Text(verbatim: label))
    }
}

/// Onboarding page 2: a small night-street map with the sharer's marker (their mascot on a
/// lamplight ring) and the viewer's (a crossing disc with their initial), joined by the dashed line.
/// The design system's own `PersonMarker`s, so the art matches the live map.
private struct LiveTogetherArt: View {
    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width, h = geo.size.height
            // Room under each marker for its name capsule.
            let sharer = CGPoint(x: w * 0.38, y: h * 0.70)
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

                PersonMarker(person: .viewer(initial: "M"), state: .live,
                             name: String(localized: "Mom"), spokenPhrase: "")
                    .position(viewer)
                PersonMarker(person: .sharer(.default), state: .live,
                             name: String(localized: "You"), spokenPhrase: "")
                    .position(sharer)
            }
        }
        .clipShape(.rect(cornerRadius: 32, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 32, style: .continuous).strokeBorder(TMLColor.separator, lineWidth: 1)
        }
        .accessibilityHidden(true)
    }
}

#Preview("Onboarding") {
    OnboardingView(model: OnboardingModel(onFinished: {}))
}
