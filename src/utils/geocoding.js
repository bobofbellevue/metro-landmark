/**
 * Geocode an address and extract city and county/region jurisdiction
 * Uses the Google Maps Geocoding API via fetch (browser-compatible)
 * @param {Object} address - Address object with address_line_1, city, state_province_region, postal_code, country
 * @returns {Promise<{city: string|null, county: string|null, error: string|null}>}
 */
export async function geocodeAddress(address) {
    const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
    
    if (!apiKey) {
        return {
            city: null,
            county: null,
            error: 'Google Maps API key is not configured. Please set VITE_GOOGLE_MAPS_API_KEY in your environment.'
        };
    }

    // Build address string for geocoding
    const addressParts = [
        address.address_line_1,
        address.address_line_2,
        address.city,
        address.state_province_region,
        address.postal_code,
        address.country
    ].filter(Boolean);

    if (addressParts.length === 0) {
        return {
            city: null,
            county: null,
            error: 'No address information provided'
        };
    }

    const addressString = addressParts.join(', ');

    try {
        // Use fetch API to call Google Maps Geocoding API (browser-compatible)
        const encodedAddress = encodeURIComponent(addressString);
        const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodedAddress}&key=${apiKey}`;
        
        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();

        if (data.status === 'OK' && data.results.length > 0) {
            const result = data.results[0];
            const addressComponents = result.address_components;

            let city = null;
            let county = null;

            // Extract city (locality or administrative_area_level_2)
            const cityComponent = addressComponents.find(component =>
                component.types.includes('locality') ||
                component.types.includes('administrative_area_level_2')
            );
            if (cityComponent) {
                city = cityComponent.long_name;
            }

            // Extract county (administrative_area_level_2 in US, or subadministrative_area_level_1)
            // In Canada, this might be a regional district or county
            const countyComponent = addressComponents.find(component =>
                component.types.includes('administrative_area_level_2') ||
                component.types.includes('subadministrative_area_level_1')
            );
            if (countyComponent) {
                county = countyComponent.long_name;
            }

            // If we found a city but no county, try to get it from other components
            if (city && !county) {
                // Sometimes county is in administrative_area_level_3
                const altCounty = addressComponents.find(component =>
                    component.types.includes('administrative_area_level_3')
                );
                if (altCounty) {
                    county = altCounty.long_name;
                }
            }

            return {
                city: city,
                county: county,
                error: null
            };
        } else if (data.status === 'ZERO_RESULTS') {
            return {
                city: null,
                county: null,
                error: 'Address could not be found. Please verify the address is correct.'
            };
        } else {
            return {
                city: null,
                county: null,
                error: `Geocoding failed: ${data.status}`
            };
        }
    } catch (error) {
        console.error('Geocoding error:', error);
        return {
            city: null,
            county: null,
            error: error.message || 'Failed to geocode address. Please check your internet connection and try again.'
        };
    }
}

