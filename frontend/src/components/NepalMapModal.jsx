/* eslint-disable react/prop-types */
import { useEffect, useRef, useState, useMemo } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  NEPAL_CITIES,
  NEPAL_PROVINCES,
  findNearestNepalCity,
  getCityInfo,
} from "../data/nepalLocations";
import { toast } from "react-toastify";

// Custom pin marker icon using Leaflet DivIcon with inline SVG
const createPinIcon = () =>
  L.divIcon({
    className: "custom-map-pin",
    html: `
      <div style="position: relative; width: 32px; height: 32px; transform: translate(-16px, -32px);">
        <svg viewBox="0 0 24 24" width="32" height="32" fill="#e11d48" style="filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));">
          <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
        </svg>
      </div>
    `,
    iconSize: [32, 32],
    iconAnchor: [16, 32],
  });

const NepalMapModal = ({
  isOpen,
  onClose,
  onLocationSelect,
  initialCity = "Kathmandu",
}) => {
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markerRef = useRef(null);
  const searchDropdownRef = useRef(null);
  const reverseGeocodeRequestRef = useRef(0);

  const defaultCityInfo = getCityInfo(initialCity) || NEPAL_CITIES[0];

  const [selectedLocation, setSelectedLocation] = useState({
    city: defaultCityInfo.name,
    state: defaultCityInfo.province,
    district: "",
    zipcode: defaultCityInfo.zipcode,
    lat: defaultCityInfo.lat,
    lng: defaultCityInfo.lng,
    addressSnippet: "",
    area: "",
  });

  const [locating, setLocating] = useState(false);
  const [isResolvingAddress, setIsResolvingAddress] = useState(false);

  // Search feature states
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);

  // Predefined shortcut cities: existing ones + POKHARA
  const shortcutCities = useMemo(() => {
    return [
      NEPAL_CITIES.find((c) => c.name === "Kathmandu"),
      NEPAL_CITIES.find((c) => c.name === "Pokhara"), // Explicitly added as requested
      NEPAL_CITIES.find((c) => c.name.includes("Lalitpur")),
      NEPAL_CITIES.find((c) => c.name.includes("Bhaktapur")),
      NEPAL_CITIES.find((c) => c.name.includes("Bharatpur")),
      NEPAL_CITIES.find((c) => c.name === "Hetauda"),
      NEPAL_CITIES.find((c) => c.name === "Banepa"),
      NEPAL_CITIES.find((c) => c.name === "Dhulikhel"),
      NEPAL_CITIES.find((c) => c.name === "Butwal"),
      NEPAL_CITIES.find((c) => c.name === "Biratnagar"),
    ].filter(Boolean);
  }, []);

  // Initialize and mount Leaflet map
  useEffect(() => {
    if (!isOpen) return;
    setIsResolvingAddress(false);

    const timer = setTimeout(() => {
      if (!mapContainerRef.current) return;

      // Clean up previous instance if any
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }

      const initialLocation = getCityInfo(initialCity) || NEPAL_CITIES[0];

      setSelectedLocation({
        city: initialLocation.name,
        state: initialLocation.province,
        district: "",
        zipcode: initialLocation.zipcode,
        lat: initialLocation.lat,
        lng: initialLocation.lng,
        addressSnippet: "",
        area: "",
      });

      // Nepal bounds
      const southWest = L.latLng(26.3, 80.0);
      const northEast = L.latLng(30.5, 88.3);
      const nepalBounds = L.latLngBounds(southWest, northEast);

      const map = L.map(mapContainerRef.current, {
        center: [initialLocation.lat, initialLocation.lng],
        zoom: 12,
        minZoom: 6,
        maxZoom: 18,
        maxBounds: nepalBounds,
        maxBoundsViscosity: 0.8,
      });

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(map);

      // Add pin marker
      const marker = L.marker([initialLocation.lat, initialLocation.lng], {
        icon: createPinIcon(),
        draggable: true,
      }).addTo(map);

      marker.on("dragend", async (e) => {
        const { lat, lng } = e.target.getLatLng();
        handleCoordinatesSelected(lat, lng, map);
      });

      map.on("click", (e) => {
        const { lat, lng } = e.latlng;
        marker.setLatLng([lat, lng]);
        handleCoordinatesSelected(lat, lng, map);
      });

      mapInstanceRef.current = map;
      markerRef.current = marker;
    }, 100);

    return () => {
      clearTimeout(timer);
      reverseGeocodeRequestRef.current += 1;
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [isOpen, initialCity]);

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (
        searchDropdownRef.current &&
        !searchDropdownRef.current.contains(e.target)
      ) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Handle coordinates clicked/dragged on map
  const handleCoordinatesSelected = async (lat, lng, map) => {
    const matched = findNearestNepalCity(lat, lng);
    const requestId = ++reverseGeocodeRequestRef.current;
    const initialLocation = {
      city: matched.name,
      state: matched.province,
      district: "",
      zipcode: matched.zipcode,
      lat: Number(lat.toFixed(5)),
      lng: Number(lng.toFixed(5)),
      addressSnippet: "",
      area: "",
    };
    setSelectedLocation(initialLocation);
    setIsResolvingAddress(true);

    let addressSnippet = "";
    let area = "";
    let district = "";
    let zipcode = matched.zipcode;
    let province = matched.province;
    try {
      // Reverse geocoding via OpenStreetMap Nominatim
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`,
        {
          headers: {
            "Accept-Language": "en",
          },
        }
      );
      if (!res.ok) {
        throw new Error(`Reverse geocoding failed with status ${res.status}`);
      }
      const data = await res.json();
      const address = data.address || {};
      addressSnippet = address.road || address.pedestrian || address.path || "";
      area = address.neighbourhood
        || address.suburb
        || address.quarter
        || address.residential
        || address.village
        || address.hamlet
        || "";
      district = address.county || address.state_district || address.district || "";
      zipcode = address.postcode || zipcode;
      province = NEPAL_PROVINCES.find(
        (value) => value.toLocaleLowerCase() === String(address.state || "").toLocaleLowerCase()
      ) || province;
      if (requestId !== reverseGeocodeRequestRef.current) return;
    } catch (error) {
      if (requestId === reverseGeocodeRequestRef.current) {
        console.error("Unable to reverse geocode selected map location:", error);
        toast.info("Could not identify the street name. Please review the address fields after selecting.");
      }
    } finally {
      if (requestId === reverseGeocodeRequestRef.current) {
        setIsResolvingAddress(false);
      }
    }

    setSelectedLocation({
      city: matched.name,
      state: province,
      district,
      zipcode,
      lat: Number(lat.toFixed(5)),
      lng: Number(lng.toFixed(5)),
      addressSnippet,
      area,
    });

    if (map) {
      map.panTo([lat, lng]);
    }
  };

  // Quick select a predefined Nepal city
  const handleSelectCityChip = (cityObj) => {
    if (mapInstanceRef.current && markerRef.current) {
      markerRef.current.setLatLng([cityObj.lat, cityObj.lng]);
      mapInstanceRef.current.flyTo([cityObj.lat, cityObj.lng], 13);
    }
    handleCoordinatesSelected(cityObj.lat, cityObj.lng, mapInstanceRef.current);
  };

  // Debounced search for location in Nepal
  useEffect(() => {
    if (!searchTerm.trim() || searchTerm.trim().length < 2) {
      setSearchResults([]);
      setShowDropdown(false);
      return;
    }

    const qLower = searchTerm.toLowerCase();

    // 1. Instant local matching from NEPAL_CITIES
    const localMatches = NEPAL_CITIES.filter(
      (c) =>
        c.name.toLowerCase().includes(qLower) ||
        c.province.toLowerCase().includes(qLower)
    ).map((c) => ({
      name: c.name,
      subtitle: `${c.province} • Postal: ${c.zipcode}`,
      lat: c.lat,
      lng: c.lng,
      isCity: true,
      cityObj: c,
    }));

    setSearchResults(localMatches);
    setShowDropdown(true);

    // 2. Query OpenStreetMap Nominatim bounded to Nepal for detailed streets/places
    const debounceTimer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
          searchTerm
        )}&countrycodes=np&limit=6&addressdetails=1`;
        const res = await fetch(url, {
          headers: { "Accept-Language": "en" },
        });

        if (res.ok) {
          const data = await res.json();
          const remoteResults = data.map((item) => ({
            name: item.display_name.split(",")[0],
            subtitle: item.display_name,
            lat: parseFloat(item.lat),
            lng: parseFloat(item.lon),
            isNominatim: true,
          }));

          // Merge local and remote results without duplicates
          const seen = new Set();
          const merged = [];

          for (const item of [...localMatches, ...remoteResults]) {
            const key = `${item.name.toLowerCase()}-${Math.round(item.lat * 100)}`;
            if (!seen.has(key)) {
              seen.add(key);
              merged.push(item);
            }
          }

          setSearchResults(merged.slice(0, 8));
          setShowDropdown(merged.length > 0);
        }
      } catch (err) {
        console.error("Nominatim search error:", err);
      } finally {
        setIsSearching(false);
      }
    }, 400);

    return () => clearTimeout(debounceTimer);
  }, [searchTerm]);

  // Handle selecting a search result
  const handleSelectSearchResult = (result) => {
    const { lat, lng } = result;

    if (result.isCity && result.cityObj) {
      handleSelectCityChip(result.cityObj);
    } else {
      if (markerRef.current && mapInstanceRef.current) {
        markerRef.current.setLatLng([lat, lng]);
        mapInstanceRef.current.flyTo([lat, lng], 15);
      }
      handleCoordinatesSelected(lat, lng, mapInstanceRef.current);
    }

    setSearchTerm(result.name);
    setShowDropdown(false);
    toast.success(`Location set: ${result.name}`);
  };

  // Handle pressing Enter in search input
  const handleSearchKeyDown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (searchResults.length > 0) {
        handleSelectSearchResult(searchResults[0]);
      }
    } else if (e.key === "Escape") {
      setShowDropdown(false);
    }
  };

  // Browser Geolocation / GPS
  const handleUseCurrentLocation = () => {
    if (!navigator.geolocation) {
      toast.error("Geolocation is not supported by your browser");
      return;
    }

    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        setLocating(false);
        const { latitude, longitude } = pos.coords;

        // Check if within Nepal geographic limits (~26.0 to 31.0 N, ~79.5 to 89.0 E)
        if (
          latitude < 26.0 ||
          latitude > 31.0 ||
          longitude < 79.5 ||
          longitude > 89.0
        ) {
          toast.info(
            "Your current GPS is outside Nepal. Defaulting to Kathmandu."
          );
          handleSelectCityChip(NEPAL_CITIES[0]);
          return;
        }

        if (markerRef.current && mapInstanceRef.current) {
          markerRef.current.setLatLng([latitude, longitude]);
          mapInstanceRef.current.flyTo([latitude, longitude], 15);
        }

        await handleCoordinatesSelected(
          latitude,
          longitude,
          mapInstanceRef.current
        );
        toast.success("GPS location identified!");
      },
      (err) => {
        setLocating(false);
        console.error("GPS error:", err);
        toast.error("Unable to retrieve your location. Please select on the map.");
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  // Confirm selection and pass back to PlaceOrder
  const handleConfirm = () => {
    onLocationSelect(selectedLocation);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-sm animate-fadeIn">
      <div className="bg-white rounded-2xl w-full max-w-3xl max-h-[92vh] flex flex-col shadow-2xl border border-gray-100 overflow-hidden animate-scaleUp">
        
        {/* Header */}
        <div className="bg-gray-900 text-white px-5 py-3.5 flex items-center justify-between flex-shrink-0">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-base font-bold">Choose Delivery Location (Nepal 🇳🇵)</span>
            </div>
            <p className="text-xs text-gray-300">
              Search any place, click anywhere on the map, or use shortcuts to auto-fill address
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-white p-1 rounded-full hover:bg-gray-800 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Location Search Bar */}
        <div className="bg-gray-50 border-b border-gray-200 px-4 py-2.5 relative flex-shrink-0" ref={searchDropdownRef}>
          <div className="relative">
            <svg
              className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
            <input
              type="text"
              placeholder="Search location in Nepal (e.g. Pokhara, Lakeside, Thamel, New Road, Chitwan)..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onFocus={() => {
                if (searchResults.length > 0) setShowDropdown(true);
              }}
              onKeyDown={handleSearchKeyDown}
              className="w-full pl-9 pr-8 py-2 text-xs bg-white border border-gray-300 rounded-xl shadow-xs focus:outline-none focus:border-rose-500 focus:ring-1 focus:ring-rose-500"
            />
            {isSearching ? (
              <div className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 border-2 border-rose-500 border-t-transparent rounded-full animate-spin"></div>
            ) : searchTerm ? (
              <button
                type="button"
                onClick={() => {
                  setSearchTerm("");
                  setSearchResults([]);
                  setShowDropdown(false);
                }}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-1 text-xs"
              >
                ✕
              </button>
            ) : null}
          </div>

          {/* Autocomplete Dropdown */}
          {showDropdown && searchResults.length > 0 && (
            <div className="absolute left-4 right-4 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-xl z-[500] max-h-56 overflow-y-auto divide-y divide-gray-100">
              {searchResults.map((result, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => handleSelectSearchResult(result)}
                  className="w-full px-3.5 py-2 text-left hover:bg-rose-50/70 flex items-start gap-2.5 transition-colors group"
                >
                  <span className="text-sm mt-0.5 text-rose-500 group-hover:scale-110 transition-transform">
                    📍
                  </span>
                  <div className="flex-1 overflow-hidden">
                    <p className="text-xs font-bold text-gray-800 truncate">
                      {result.name}
                    </p>
                    <p className="text-[11px] text-gray-500 truncate">
                      {result.subtitle}
                    </p>
                  </div>
                  {result.isCity && (
                    <span className="bg-gray-100 text-gray-600 text-[10px] font-semibold px-1.5 py-0.5 rounded self-center">
                      City
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Action Toolbar & Shortcuts (Including Pokhara) */}
        <div className="bg-white border-b border-gray-200 px-4 py-2 flex flex-wrap items-center justify-between gap-2 flex-shrink-0">
          {/* GPS Auto-Detect Button */}
          <button
            type="button"
            onClick={handleUseCurrentLocation}
            disabled={locating}
            className="bg-rose-600 hover:bg-rose-700 active:scale-95 text-white text-xs font-semibold px-3 py-1.5 rounded-lg flex items-center gap-1.5 shadow-xs transition-all disabled:opacity-50"
          >
            {locating ? (
              <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
            ) : (
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            )}
            <span>GPS Location</span>
          </button>

          {/* Quick City Shortcut Chips (Includes previous + Pokhara) */}
          <div className="flex items-center gap-1.5 overflow-x-auto max-w-full pb-1 sm:pb-0 scrollbar-none text-xs">
            <span className="text-[11px] text-gray-500 font-medium whitespace-nowrap">
              Shortcuts:
            </span>
            {shortcutCities.map((c) => {
              const isPokhara = c.name === "Pokhara";
              const isSelected = selectedLocation.city === c.name;

              return (
                <button
                  type="button"
                  key={c.name}
                  onClick={() => handleSelectCityChip(c)}
                  className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-all whitespace-nowrap flex items-center gap-1 ${
                    isSelected
                      ? "bg-black text-white shadow-xs"
                      : isPokhara
                      ? "bg-rose-50 border border-rose-200 text-rose-700 hover:bg-rose-100 font-semibold"
                      : "bg-gray-100 border border-gray-200 text-gray-700 hover:bg-gray-200"
                  }`}
                >
                  {isPokhara && <span>🌟</span>}
                  <span>{c.name.split(" ")[0]}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Leaflet Map Container */}
        <div className="relative flex-1 min-h-[300px] sm:min-h-[360px] w-full bg-slate-100">
          <div ref={mapContainerRef} className="w-full h-full" style={{ minHeight: "320px" }} />
          <div className="absolute top-2 right-2 z-[400] bg-white/90 backdrop-blur-sm px-2.5 py-1 rounded-md text-[10px] text-gray-600 shadow-sm pointer-events-none">
            📍 Drag pin or click map to move
          </div>
        </div>

        {/* Selected Location Summary Bar */}
        <div className="bg-white border-t border-gray-200 p-4 flex flex-col sm:flex-row items-center justify-between gap-3 flex-shrink-0">
          <div className="w-full sm:w-auto">
            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
              Selected Nepal Location
            </p>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              <span className="font-bold text-sm text-gray-900">
                {selectedLocation.city}
              </span>
              <span className="text-xs text-gray-500">• {selectedLocation.state}</span>
              <span className="bg-amber-100 text-amber-800 text-[10px] font-semibold px-2 py-0.5 rounded">
                Postal Code: {selectedLocation.zipcode}
              </span>
              <span className="text-[11px] text-gray-400">
                ({selectedLocation.lat}, {selectedLocation.lng})
              </span>
            </div>
            {selectedLocation.addressSnippet && (
              <p className="text-xs text-emerald-600 mt-0.5">
                Area: {selectedLocation.addressSnippet}
              </p>
            )}
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-medium text-gray-600 hover:bg-gray-100 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={isResolvingAddress}
              className="bg-black hover:bg-gray-800 active:scale-95 text-white px-5 py-2 rounded-xl text-xs font-semibold transition-all shadow-sm flex items-center gap-1.5 disabled:cursor-wait disabled:opacity-60"
            >
              {isResolvingAddress ? (
                <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                </svg>
              )}
              <span>{isResolvingAddress ? "Finding address..." : "Apply This Location"}</span>
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};

export default NepalMapModal;
