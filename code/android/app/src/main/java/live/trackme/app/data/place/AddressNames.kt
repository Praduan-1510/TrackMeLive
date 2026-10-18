package live.trackme.app.data.place

import android.location.Address
import java.util.Locale

/** The fields of an [android.location.Address] the place reads, as plain values (testable on the JVM). */
data class AddressFields(
    val featureName: String? = null,
    /** The house number. */
    val subThoroughfare: String? = null,
    val thoroughfare: String? = null,
    val subLocality: String? = null,
    val locality: String? = null,
    val subAdminArea: String? = null,
    val adminArea: String? = null,
    val postalCode: String? = null,
    val countryName: String? = null,
    /** getAddressLine(0): the formatted first line, often "221B Baker Street". */
    val firstLine: String? = null,
) {
    companion object {
        fun of(address: Address): AddressFields = AddressFields(
            featureName = address.featureName,
            subThoroughfare = address.subThoroughfare,
            thoroughfare = address.thoroughfare,
            subLocality = address.subLocality,
            locality = address.locality,
            subAdminArea = address.subAdminArea,
            adminArea = address.adminArea,
            postalCode = address.postalCode,
            countryName = address.countryName,
            firstLine = if (address.maxAddressLineIndex >= 0) address.getAddressLine(0) else null,
        )
    }
}

/**
 * An address's four parts (x-decisions Q-PLACE): street from the thoroughfare, area from the
 * sub-locality, city from the locality, and a name only when the feature name is a real place (a park,
 * a landmark, a venue). Geocoders put almost anything in the feature name: the house number, the
 * street again, the first address line, a postcode, the town or a plus code. None of those is a name.
 */
object AddressNames {
    fun partsOf(address: AddressFields): PlaceParts? {
        val street = PlaceText.clean(address.thoroughfare)?.takeUnless { it.key() in UNNAMED_ROADS }
        val city = PlaceText.clean(address.locality)
        // An area that only repeats the city says nothing more.
        val area = PlaceText.clean(address.subLocality)?.takeUnless { city != null && it.key() == city.key() }
        return PlaceParts.of(poiName(address, street), street, area, city)
    }

    private fun poiName(address: AddressFields, street: String?): String? {
        val name = PlaceText.clean(address.featureName) ?: return null
        val key = name.key()
        val repeats = listOfNotNull(
            address.subThoroughfare, street, address.subLocality, address.locality, address.subAdminArea,
            address.adminArea, address.postalCode, address.countryName, address.firstLine,
        ).map { it.key() }
        val houseNumber = address.subThoroughfare?.key()
        return name.takeUnless {
            key in repeats ||
                key in UNNAMED_ROADS ||
                HOUSE_NUMBER.matches(name) ||
                PLUS_CODE.containsMatchIn(name) ||
                // "221B Baker St": the house number and the street, however the street is spelled.
                (houseNumber != null && key.startsWith("$houseNumber ")) ||
                (street != null && key.contains(street.key())) ||
                // The first address line, or the start of it ("221B Baker St, London").
                (address.firstLine != null && address.firstLine.key().startsWith("$key,"))
        }
    }

    /** Lowercase with runs of whitespace as one space, for comparing parts. */
    private fun String.key(): String = trim().lowercase(Locale.ROOT).replace(WHITESPACE, " ")

    private val WHITESPACE = Regex("\\s+")

    /** 12, 12a, 12-14, 4/2, 221B: a house number, never a name. */
    private val HOUSE_NUMBER = Regex("^\\d+[\\p{L}]?(?:\\s*[-/]\\s*\\d+[\\p{L}]?)*$")

    /** An Open Location Code ("8FVC9G8F+6W", "9G8F+6W Oakland"), which Google's geocoder gives where there's no address. */
    private val PLUS_CODE = Regex("(?i)\\b[23456789CFGHJMPQRVWX]{2,8}\\+[23456789CFGHJMPQRVWX]{0,3}")

    /** Google's placeholder for a road without a name. */
    private val UNNAMED_ROADS = setOf("unnamed road")
}
