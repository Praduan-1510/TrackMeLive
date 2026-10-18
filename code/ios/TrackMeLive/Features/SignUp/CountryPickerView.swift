import SwiftUI
import TMLCore

/// The country list for the number field: every region by name in the reader's language, with its
/// calling code, searchable by name, code or "+44". The current one is checked and in view on open.
struct CountryPickerView: View {
    let selected: PhoneRegion
    let onSelect: (PhoneRegion) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""

    private static let sorted: [(region: PhoneRegion, name: String)] = PhoneRegion.all
        .map { ($0, $0.name()) }
        .sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }

    private var matches: [(region: PhoneRegion, name: String)] {
        let needle = query.trimmingCharacters(in: .whitespaces)
        guard !needle.isEmpty else { return Self.sorted }
        let digits = needle.filter(\.isNumber)
        return Self.sorted.filter { entry in
            entry.name.localizedStandardContains(needle)
                || entry.region.code.caseInsensitiveCompare(needle) == .orderedSame
                || (!digits.isEmpty && entry.region.callingCode.hasPrefix(digits))
        }
    }

    var body: some View {
        NavigationStack {
            ScrollViewReader { proxy in
                List(matches, id: \.region.id) { entry in
                    Button {
                        onSelect(entry.region)
                        dismiss()
                    } label: {
                        HStack(spacing: TMLSpacing.space3) {
                            Text(verbatim: entry.name)
                                .foregroundStyle(TMLColor.ink)
                                .fixedSize(horizontal: false, vertical: true)
                            Spacer(minLength: TMLSpacing.space2)
                            Text(verbatim: "+\(entry.region.callingCode)")
                                .monospacedDigit()
                                .foregroundStyle(TMLColor.inkSecondary)
                            Image(systemName: "checkmark")
                                .font(.body.weight(.semibold))
                                .foregroundStyle(TMLColor.lamplightText)
                                .opacity(entry.region == selected ? 1 : 0)
                                .accessibilityHidden(true)
                        }
                        .frame(minHeight: TMLSpacing.tapTarget)
                        .contentShape(.rect)
                    }
                    .listRowBackground(TMLColor.surface)
                    .accessibilityAddTraits(entry.region == selected ? .isSelected : [])
                    .id(entry.region.id)
                }
                .scrollContentBackground(.hidden)
                .background(TMLColor.ground)
                .overlay {
                    if matches.isEmpty {
                        ContentUnavailableView.search(text: query)
                    }
                }
                .onAppear { proxy.scrollTo(selected.id, anchor: .center) }
            }
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Country or code")
            .navigationTitle("Country")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
        .tint(TMLColor.ink)
    }
}
