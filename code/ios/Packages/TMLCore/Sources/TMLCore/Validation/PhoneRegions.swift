import Foundation

/// A country or territory in the sign-up number field's picker, with its calling code.
///
/// Every region gets an E.164 check: 4–14 national digits and at most 15 digits overall. About 30
/// regions, those with the most mobile users, also get libphonenumber's mobile length and
/// leading-digit rules and its example mobile number (`exampleNational`, used in "Enter your full
/// mobile number, like …"). Android validates with libphonenumber itself, so for every other
/// region iOS is the more lenient of the two. Firebase Auth then rejects what slips through, and
/// the app shows the same message.
public struct PhoneRegion: Hashable, Sendable, Identifiable {
    /// ISO 3166-1 alpha-2, e.g. "US".
    public let code: String
    /// The country calling code without "+", e.g. "1".
    public let callingCode: String
    /// The national trunk prefix people often type first ("0" in the UK, "8" in Russia), dropped from
    /// the E.164 number. Nil where there is none, or where a leading 0 belongs to the number itself.
    let trunkPrefix: String?
    /// Mobile number rules, where known.
    let rule: Rule?
    /// libphonenumber's example mobile number for the region, in national format.
    public let exampleNational: String?

    public var id: String { code }

    enum Rule: Hashable, Sendable {
        /// The North American Numbering Plan: a 10-digit number NXX-NXX-XXXX.
        case nanp
        /// Mobile numbers: national significant number lengths, and the digits they start with.
        case mobile(lengths: ClosedRange<Int>, prefixes: [String])
    }

    init(_ code: String, _ callingCode: String, trunk: String? = nil, rule: Rule? = nil, example: String? = nil) {
        self.code = code
        self.callingCode = callingCode
        self.trunkPrefix = trunk
        self.rule = rule
        self.exampleNational = example
    }

    /// The region's name in the reader's language, e.g. "United States".
    public func name(locale: Locale = .current) -> String {
        locale.localizedString(forRegionCode: code) ?? code
    }

    /// The default for the picker: the device's region when it has a calling code, otherwise the US.
    /// (iOS has no API for the SIM's or network's country.)
    public static func defaultRegion(locale: Locale = .current) -> PhoneRegion {
        locale.region.flatMap { region(code: $0.identifier) } ?? us
    }

    public static func region(code: String) -> PhoneRegion? {
        byCode[code.uppercased()]
    }

    /// The region a "+" number belongs to: the longest calling code that starts the digits. Several
    /// regions share a code (+1, +44, +7…): `preferred` wins when it has that code, otherwise the
    /// code's main region (the US for +1).
    static func region(forInternationalDigits digits: Substring, preferred: PhoneRegion) -> PhoneRegion? {
        for length in stride(from: 3, through: 1, by: -1) where digits.count > length {
            let code = String(digits.prefix(length))
            if preferred.callingCode == code { return preferred }
            if let main = mainRegionByCallingCode[code] { return main }
        }
        return nil
    }

    static let us = PhoneRegion("US", "1", rule: .nanp, example: "(201) 555-0123")

    /// Every region, in no particular order. Sort by `name(locale:)` for display.
    public static let all: [PhoneRegion] = curated + others

    // libphonenumber's mobile rules (simplified to leading digits and lengths) and example numbers.
    private static let curated: [PhoneRegion] = [
        us,
        PhoneRegion("CA", "1", rule: .nanp, example: "(506) 234-5678"),
        PhoneRegion("GB", "44", trunk: "0", rule: .mobile(lengths: 10...10, prefixes: ["7"]), example: "07400 123456"),
        PhoneRegion("IN", "91", trunk: "0", rule: .mobile(lengths: 10...10, prefixes: ["6", "7", "8", "9"]), example: "081234 56789"),
        PhoneRegion("AU", "61", trunk: "0", rule: .mobile(lengths: 9...9, prefixes: ["4"]), example: "0412 345 678"),
        PhoneRegion("DE", "49", trunk: "0", rule: .mobile(lengths: 10...11, prefixes: ["15", "16", "17"]), example: "01512 3456789"),
        PhoneRegion("FR", "33", trunk: "0", rule: .mobile(lengths: 9...9, prefixes: ["6", "7"]), example: "06 12 34 56 78"),
        PhoneRegion("ES", "34", rule: .mobile(lengths: 9...9, prefixes: ["6", "7"]), example: "612 34 56 78"),
        PhoneRegion("IT", "39", rule: .mobile(lengths: 9...10, prefixes: ["3"]), example: "312 345 6789"),
        PhoneRegion("BR", "55", trunk: "0", rule: .mobile(lengths: 11...11, prefixes: ["1", "2", "3", "4", "5", "6", "7", "8", "9"]), example: "(11) 96123-4567"),
        PhoneRegion("MX", "52", rule: .mobile(lengths: 10...10, prefixes: ["2", "3", "4", "5", "6", "7", "8", "9"]), example: "222 123 4567"),
        PhoneRegion("JP", "81", trunk: "0", rule: .mobile(lengths: 10...10, prefixes: ["70", "80", "90"]), example: "090-1234-5678"),
        PhoneRegion("CN", "86", trunk: "0", rule: .mobile(lengths: 11...11, prefixes: ["13", "14", "15", "16", "17", "18", "19"]), example: "131 2345 6789"),
        PhoneRegion("NG", "234", trunk: "0", rule: .mobile(lengths: 10...10, prefixes: ["70", "80", "81", "90", "91"]), example: "0802 123 4567"),
        PhoneRegion("PK", "92", trunk: "0", rule: .mobile(lengths: 10...10, prefixes: ["3"]), example: "0301 2345678"),
        PhoneRegion("BD", "880", trunk: "0", rule: .mobile(lengths: 10...10, prefixes: ["13", "14", "15", "16", "17", "18", "19"]), example: "01812-345678"),
        PhoneRegion("PH", "63", trunk: "0", rule: .mobile(lengths: 10...10, prefixes: ["9"]), example: "0905 123 4567"),
        PhoneRegion("ID", "62", trunk: "0", rule: .mobile(lengths: 9...12, prefixes: ["8"]), example: "0812-345-678"),
        PhoneRegion("ZA", "27", trunk: "0", rule: .mobile(lengths: 9...9, prefixes: ["6", "7", "8"]), example: "071 123 4567"),
        PhoneRegion("AE", "971", trunk: "0", rule: .mobile(lengths: 9...9, prefixes: ["5"]), example: "050 123 4567"),
        PhoneRegion("SG", "65", rule: .mobile(lengths: 8...8, prefixes: ["8", "9"]), example: "8123 4567"),
        PhoneRegion("NZ", "64", trunk: "0", rule: .mobile(lengths: 8...10, prefixes: ["2"]), example: "021 123 4567"),
        PhoneRegion("IE", "353", trunk: "0", rule: .mobile(lengths: 9...9, prefixes: ["8"]), example: "085 012 3456"),
        PhoneRegion("NL", "31", trunk: "0", rule: .mobile(lengths: 9...9, prefixes: ["6"]), example: "06 12345678"),
        PhoneRegion("SA", "966", trunk: "0", rule: .mobile(lengths: 9...9, prefixes: ["5"]), example: "051 234 5678"),
        PhoneRegion("KR", "82", trunk: "0", rule: .mobile(lengths: 9...10, prefixes: ["1"]), example: "010-2000-0000"),
        PhoneRegion("BE", "32", trunk: "0", rule: .mobile(lengths: 9...9, prefixes: ["4"]), example: "0470 12 34 56"),
        PhoneRegion("SE", "46", trunk: "0", rule: .mobile(lengths: 9...9, prefixes: ["7"]), example: "070-123 45 67"),
        PhoneRegion("CH", "41", trunk: "0", rule: .mobile(lengths: 9...9, prefixes: ["7"]), example: "078 123 45 67"),
        PhoneRegion("KE", "254", trunk: "0", rule: .mobile(lengths: 9...9, prefixes: ["1", "7"]), example: "0712 123456"),
    ]

    // Everywhere else: the calling code, and the trunk prefix where people commonly type one.
    private static let others: [PhoneRegion] = {
        let trunkZero: Set<String> = [
            "AF", "AL", "AM", "AR", "AT", "AZ", "BA", "BG", "CU", "DZ", "EC", "EG", "ET", "FI", "GE", "GG", "GH",
            "HR", "IL", "IM", "IQ", "IR", "JE", "JO", "KH", "LB", "LK", "LY", "MA", "ME", "MK", "MM", "MY", "NP",
            "PY", "RO", "RS", "RW", "SD", "SI", "SK", "SY", "TH", "TR", "TW", "TZ", "UA", "UG", "UY", "VE", "VN",
            "YE", "ZM", "ZW",
        ]
        let trunkEight: Set<String> = ["RU", "KZ", "BY"]
        let codes: [(String, String)] = [
            ("AD", "376"), ("AF", "93"), ("AG", "1"), ("AI", "1"), ("AL", "355"), ("AM", "374"), ("AO", "244"),
            ("AR", "54"), ("AS", "1"), ("AT", "43"), ("AW", "297"), ("AX", "358"), ("AZ", "994"), ("BA", "387"),
            ("BB", "1"), ("BF", "226"), ("BG", "359"), ("BH", "973"), ("BI", "257"), ("BJ", "229"), ("BL", "590"),
            ("BM", "1"), ("BN", "673"), ("BO", "591"), ("BQ", "599"), ("BS", "1"), ("BT", "975"), ("BW", "267"),
            ("BY", "375"), ("BZ", "501"), ("CC", "61"), ("CD", "243"), ("CF", "236"), ("CG", "242"), ("CI", "225"),
            ("CK", "682"), ("CL", "56"), ("CM", "237"), ("CO", "57"), ("CR", "506"), ("CU", "53"), ("CV", "238"),
            ("CW", "599"), ("CX", "61"), ("CY", "357"), ("CZ", "420"), ("DJ", "253"), ("DK", "45"), ("DM", "1"),
            ("DO", "1"), ("DZ", "213"), ("EC", "593"), ("EE", "372"), ("EG", "20"), ("EH", "212"), ("ER", "291"),
            ("ET", "251"), ("FI", "358"), ("FJ", "679"), ("FK", "500"), ("FM", "691"), ("FO", "298"), ("GA", "241"),
            ("GD", "1"), ("GE", "995"), ("GF", "594"), ("GG", "44"), ("GH", "233"), ("GI", "350"), ("GL", "299"),
            ("GM", "220"), ("GN", "224"), ("GP", "590"), ("GQ", "240"), ("GR", "30"), ("GT", "502"), ("GU", "1"),
            ("GW", "245"), ("GY", "592"), ("HK", "852"), ("HN", "504"), ("HR", "385"), ("HT", "509"), ("HU", "36"),
            ("IL", "972"), ("IM", "44"), ("IO", "246"), ("IQ", "964"), ("IR", "98"), ("IS", "354"), ("JE", "44"),
            ("JM", "1"), ("JO", "962"), ("KG", "996"), ("KH", "855"), ("KI", "686"), ("KM", "269"), ("KN", "1"),
            ("KP", "850"), ("KW", "965"), ("KY", "1"), ("KZ", "7"), ("LA", "856"), ("LB", "961"), ("LC", "1"),
            ("LI", "423"), ("LK", "94"), ("LR", "231"), ("LS", "266"), ("LT", "370"), ("LU", "352"), ("LV", "371"),
            ("LY", "218"), ("MA", "212"), ("MC", "377"), ("MD", "373"), ("ME", "382"), ("MF", "590"), ("MG", "261"),
            ("MH", "692"), ("MK", "389"), ("ML", "223"), ("MM", "95"), ("MN", "976"), ("MO", "853"), ("MP", "1"),
            ("MQ", "596"), ("MR", "222"), ("MS", "1"), ("MT", "356"), ("MU", "230"), ("MV", "960"), ("MW", "265"),
            ("MY", "60"), ("MZ", "258"), ("NA", "264"), ("NC", "687"), ("NE", "227"), ("NF", "672"), ("NI", "505"),
            ("NO", "47"), ("NP", "977"), ("NR", "674"), ("NU", "683"), ("OM", "968"), ("PA", "507"), ("PE", "51"),
            ("PF", "689"), ("PG", "675"), ("PL", "48"), ("PM", "508"), ("PR", "1"), ("PS", "970"), ("PT", "351"),
            ("PW", "680"), ("PY", "595"), ("QA", "974"), ("RE", "262"), ("RO", "40"), ("RS", "381"), ("RU", "7"),
            ("RW", "250"), ("SB", "677"), ("SC", "248"), ("SD", "249"), ("SH", "290"), ("SI", "386"), ("SJ", "47"),
            ("SK", "421"), ("SL", "232"), ("SM", "378"), ("SN", "221"), ("SO", "252"), ("SR", "597"), ("SS", "211"),
            ("ST", "239"), ("SV", "503"), ("SX", "1"), ("SY", "963"), ("SZ", "268"), ("TC", "1"), ("TD", "235"),
            ("TG", "228"), ("TH", "66"), ("TJ", "992"), ("TK", "690"), ("TL", "670"), ("TM", "993"), ("TN", "216"),
            ("TO", "676"), ("TR", "90"), ("TT", "1"), ("TV", "688"), ("TW", "886"), ("TZ", "255"), ("UA", "380"),
            ("UG", "256"), ("UY", "598"), ("UZ", "998"), ("VA", "39"), ("VC", "1"), ("VE", "58"), ("VG", "1"),
            ("VI", "1"), ("VN", "84"), ("VU", "678"), ("WF", "681"), ("WS", "685"), ("XK", "383"), ("YE", "967"),
            ("YT", "262"), ("ZM", "260"), ("ZW", "263"),
        ]
        return codes.map { code, callingCode in
            // Every +1 region dials the North American Numbering Plan.
            let rule: Rule? = callingCode == "1" ? .nanp : nil
            let trunk = trunkZero.contains(code) ? "0" : trunkEight.contains(code) ? "8" : nil
            return PhoneRegion(code, callingCode, trunk: trunk, rule: rule)
        }
    }()

    private static let byCode: [String: PhoneRegion] = Dictionary(all.map { ($0.code, $0) }, uniquingKeysWith: { first, _ in first })

    /// For a "+" number in a shared code, the region it most likely belongs to.
    private static let mainRegionByCallingCode: [String: PhoneRegion] = {
        let main = ["1": "US", "7": "RU", "39": "IT", "44": "GB", "47": "NO", "61": "AU", "212": "MA", "262": "RE",
                    "290": "SH", "358": "FI", "590": "GP", "599": "CW"]
        var result: [String: PhoneRegion] = [:]
        for region in all where result[region.callingCode] == nil || main[region.callingCode] == region.code {
            result[region.callingCode] = region
        }
        return result
    }()
}
