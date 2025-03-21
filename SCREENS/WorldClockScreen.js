// screens/WorldClockScreen.js
import React, { useState, useEffect, useMemo } from "react";
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    SafeAreaView,
    ScrollView,
    ActivityIndicator,
} from "react-native";
import { Searchbar } from "react-native-paper";
import { StatusBar } from "expo-status-bar";
import moment from "moment-timezone";
import ct from "countries-and-timezones";

const WorldClockScreen = () => {
    const [searchQuery, setSearchQuery] = useState("");
    const [searchResults, setSearchResults] = useState([]);
    const [selectedClocks, setSelectedClocks] = useState([]);
    const [showSearchResults, setShowSearchResults] = useState(false);
    const [loading, setLoading] = useState(true);
    const [searchType, setSearchType] = useState(null); // 'country' or 'city'
    
   
   
   
   
   
    const timeZoneData = moment.tz.names().map((timeZone) => {
        const country = timeZone.split('/').pop().replace('_', ' ');
        return { country, timeZone };
      });
   
   
   
   
   
   
    // Prepare timezone data efficiently
    const locationData = useMemo(() => {
        const countries = ct.getAllCountries();
        const timezones = moment.tz.names();

        // Create a map of countries with their cities
        const data = Object.values(countries).map((country) => {
            const countryCities = country.timezones
                .map((timezone) => {
                    if (!timezones.includes(timezone)) return null;

                    const parts = timezone.split("/");
                    return {
                        id: timezone,
                        continent: parts[0],
                        country: country.name,
                        countryCode: country.id,
                        city: parts[parts.length - 1].replace(/_/g, " "),
                        timezone: timezone,
                    };
                })
                .filter((city) => city !== null);

            return {
                name: country.name,
                code: country.id,
                cities: countryCities,
            };
        });

        return data.filter((country) => country.cities.length > 0);
    }, []);



      const onChangeSearch5 = (query) => {
        setSearchQuery(query);
        setLoading(true);
    
        setTimeout(() => {
            if (query.length >= 1) { 
                const queryLower = query.toLowerCase();
    
                let results = [];
                
                locationData.forEach(country => {
                    if (country.name.toLowerCase().includes(queryLower)) {
                        results = [...results, ...country.cities];
                    } else {
                        const matchingCities = country.cities.filter(city => 
                            city.city.toLowerCase().includes(queryLower)
                        );
                        results = [...results, ...matchingCities];
                    }
                });
    
                // Ensure unique keys by checking both city and country
                const uniqueResults = Array.from(new Map(results.map(item => 
                    [`${item.timezone}-${item.city}`, item]  // Unique key combining timezone & city
                )).values());
    
                setSearchResults(uniqueResults.slice(0, 20));
                setShowSearchResults(true);
            } else {
                setSearchResults([]);
                setShowSearchResults(false);
            }
            setLoading(false);
        }, 300);
    };
    



    const addClock = (location) => {
        if (!selectedClocks.find((clock) => clock.id === location.id)) {
            setSelectedClocks([...selectedClocks, location]);
        }
        setSearchQuery("");
        setShowSearchResults(false);
    };

    const removeClock = (cityId) => {
        setSelectedClocks(
            selectedClocks.filter((clock) => clock.id !== cityId)
        );
    };

    const Clock = ({ city }) => {
        const [time, setTime] = useState(moment().tz(city.timezone));

        useEffect(() => {
            const timer = setInterval(() => {
                setTime(moment().tz(city.timezone));
            }, 1000);
            return () => clearInterval(timer);
        }, []);

        return (
            <View style={styles.clockContainer}>
                <Text style={styles.cityTitle}>
                    {`${city.continent} / ${city.country} / ${city.city}`}
                </Text>

                <View style={styles.clocksWrapper}>
                <View style={styles.digitalClockContainer}>
  <Text style={styles.digitalClockhh}>
    {time.format("h")}pm
  </Text>
  <Text style={styles.digitalClockmm}>
    {time.format("mm")}min
  </Text>
  <Text style={styles.digitalClockss}>
    {time.format("ss")}sec
  </Text>
  <Text style={styles.digitalClockms}>
    {time.format("SSS")}ms
  </Text>
</View>
                    <View style={styles.analogClockContainer}>
                        <View style={styles.analogClock}>
                            <View
                                style={[
                                    styles.hand,
                                    styles.hourHand,
                                    {
                                        transform: [
                                            {
                                                rotate: `${
                                                    (time.hours() % 12) * 30 +
                                                    time.minutes() * 0.5
                                                }deg`,
                                            },
                                        ],
                                    },
                                ]}
                            />
                            <View
                                style={[
                                    styles.hand,
                                    styles.minuteHand,
                                    {
                                        transform: [
                                            {
                                                rotate: `${
                                                    time.minutes() * 6
                                                }deg`,
                                            },
                                        ],
                                    },
                                ]}
                            />
                            <View
                                style={[
                                    styles.hand,
                                    styles.secondHand,
                                    {
                                        transform: [
                                            {
                                                rotate: `${
                                                    time.seconds() * 6
                                                }deg`,
                                            },
                                        ],
                                    },
                                ]}
                            />
                        </View>
                    </View>
                    <TouchableOpacity
                        style={styles.deleteButton}
                        onPress={() => removeClock(city.id)}
                    >
                        <Text style={styles.deleteButtonText}>DELETE</Text>
                    </TouchableOpacity>
                </View>

                <View style={styles.timezoneInfo}>
                    <Text style={styles.timezoneText}>
                        UTC {time.format("Z")}
                    </Text>
                    <Text style={styles.timezoneText}>
                        GMT {time.format("Z")}
                    </Text>
                </View>
                <View>
                    <View style={styles.dividerContainer} />
                    <View style={styles.divider} />
                </View>
            </View>
        );
    };

    return (
        <SafeAreaView style={styles.container}>
            <StatusBar style="dark" />

            <Searchbar
                placeholder="Search by country or city"
                onChangeText={onChangeSearch5}
                value={searchQuery}
                style={styles.searchBar}
                placeholderTextColor= "#4388CC"
                inputStyle={styles.placeholder}
            />

            {showSearchResults && (
                <View style={styles.searchResults}>
                    <ScrollView keyboardShouldPersistTaps="handled">
                        {loading ? (
                            <ActivityIndicator
                                style={styles.loadingIndicator}
                            />
                        ) : (
                            <>
                                {searchType === "country"
                                    ? searchResults.map((country) => (
                                          <View key={country.code}>
                                              <Text
                                                  style={styles.countryHeader}
                                              >
                                                  {country.name}
                                              </Text>
                                              {country.cities.map((city) => (
                                                  <TouchableOpacity
                                                      key={city.id}
                                                      style={
                                                          styles.searchResultItem
                                                      }
                                                      onPress={() =>
                                                          addClock(city)
                                                      }
                                                  >
                                                      <Text
                                                          style={
                                                              styles.searchResultText
                                                          }
                                                      >
                                                          {city.city}
                                                      </Text>
                                                      <Text
                                                          style={
                                                              styles.searchResultTime
                                                          }
                                                      >
                                                          {moment()
                                                              .tz(city.timezone)
                                                              .format(
                                                                  "hh:mm A"
                                                              )}
                                                      </Text>
                                                  </TouchableOpacity>
                                              ))}
                                          </View>
                                      ))
                                    : searchResults.map((city) => (
                                          <TouchableOpacity
                                              key={city.id}
                                              style={styles.searchResultItem}
                                              onPress={() => addClock(city)}
                                          >
                                              <Text
                                                  style={
                                                      styles.searchResultText
                                                  }
                                              >
                                                  {`${city.country} / ${city.city}`}
                                              </Text>
                                              <Text
                                                  style={
                                                      styles.searchResultTime
                                                  }
                                              >
                                                  {moment()
                                                      .tz(city.timezone)
                                                      .format("hh:mm A")}
                                              </Text>
                                          </TouchableOpacity>
                                      ))}
                                {searchResults.length === 0 && (
                                    <Text style={styles.noResults}>
                                        No matching locations found
                                    </Text>
                                )}
                            </>
                        )}
                    </ScrollView>
                </View>
            )}

            <ScrollView style={styles.clocksList}>
                {selectedClocks.map((city) => (
                    <Clock key={city.id} city={city} />
                ))}
            </ScrollView>
        </SafeAreaView>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: "#fff",
    },

    placeholder: {
        fontSize: 18, // 👈 Change font size here
        color: "#4388CC", // Optional: Apply color to text as well
        fontWeight: "bold",
    },


    searchBar: {
        margin: 10,
        elevation: 4,
        borderRadius: 5,
        backgroundColor: "#FFCC33",
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
    },
    searchResults: {
        position: "absolute",
        top: 80,
        left: 16,
        right: 16,
        backgroundColor: "#FFCC33",
        maxHeight: 200,
        borderRadius: 1,
        elevation: 4,
        zIndex: 1000,
    },
    countryHeader: {
        padding: 10,
        backgroundColor: "#FFCC33",
        fontWeight: "bold",
        fontSize: 25,
        color: "#4388CC",
    },
    searchResultItem: {
        padding: 16,
        borderBottomWidth: 1,
        borderBottomColor: "#4388CC",
    },
    searchResultText: {
        fontSize: 18,
        color: "#4388CC",
        fontWeight: "bold",
    },
    searchResultTime: {
        fontSize: 15,
        color: "#4388CC",
        marginTop: 4,
    },
    noResults: {
        padding: 16,
        textAlign: "center",
        color: "#4388CC",
    },
    clocksList: {
        flex: 1,
    },
    clockContainer: {
        padding: 16,
    },
    cityTitle: {
        fontSize: 20,
        fontWeight: "bold",
        marginBottom: 16,
        color: "#4388CC",
        textAlign: "center",
    },
    clocksWrapper: {
        alignItems: "center",
    },
    

 
        digitalClockContainer: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 8,
          marginBottom: 16,
          backgroundColor: 'white',
        },
        digitalClockhh: {
          fontSize: 20,
          fontWeight: 'bold',
          color: "#4388CC",
          marginRight: 15,
        },
        digitalClockmm: {
          fontSize: 20,
          fontWeight: 'bold',
          color: "#4388CC",
          marginRight: 15,
        },
        digitalClockss: {
          fontSize: 20,
          fontWeight: 'bold',
          color: "#4388CC",
          marginRight: 15,
        },
        digitalClockms: {
          fontSize: 20,
          fontWeight: 'bold',
          color: "#4388CC",
        },
        



    analogClockContainer: {
        alignItems: "center",
        marginBottom: 16,
    },
    analogClock: {
        width: 283,
        height: 283,
        borderRadius: 283 / 2,
        borderWidth: 5,
        borderColor: "#4388CC",
        backgroundColor: "#FFCC33",
        position: "relative",
    },
    hand: {
        position: "absolute",
        bottom: "50%",
        left: "50%",
        transformOrigin: "bottom",
    },
    hourHand: {
        width: 5,
        height: "30%",
        backgroundColor: "black",
        marginLeft: -2,
    },
    minuteHand: {
        width: 3,
        height: "40%",
        backgroundColor: "red",
        marginLeft: -1,
    },
    secondHand: {
        width: 1,
        height: "45%",
        backgroundColor: "red",
        marginLeft: -0.5,
    },
    deleteButtonCont: {
        flex: 1,
        justifyContent: "center", // Center vertically
        flexDirection: "row", // Set horizontal layout
        alignItems: "center", // Center vertically in the row
        alignSelf: "flex-end", // Aligns to the right
    },
    deleteButton: {
        alignSelf: "flex-end",

        backgroundColor: "#FFCC33",
        borderRadius: 25,
        padding: 5,
        width: 50, // Adjust size here
        height: 50,
        justifyContent: "center",
        alignItems: "center",
        marginTop: 10,
        borderColor: "red",
        borderWidth: 2,
    },
    deleteButtonText: {
        color: "red",
        fontSize: 10,
        fontWeight: "bold",
    },
    timezoneInfo: {
        flexDirection: "row",
        justifyContent: "space-around",
        marginVertical: 8,
    },
    timezoneText: {
        fontSize: 20,
        color: "#4388CC",
        fontWeight: "bold",
    },
    dividerContainer: {
        alignSelf: "stretch",
        flex: 1,
        alignItems: "stretch",
    },
    divider: {
        justifyContent: "center", // Center vertically

        alignItems: "center", // Center vertically in the row

        alignSelf: "center", // Center vertically
        marginBottom: 16,
        borderWidth: 1,
        borderColor: "#4388CC",
        marginVertical: 8,
        width: "130%",
        height: 5,
        backgroundColor: "#4388CC",
    },
    loadingIndicator: {
        padding: 20,
    },
});

export default WorldClockScreen;
