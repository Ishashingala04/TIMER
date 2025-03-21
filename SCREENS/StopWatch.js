import React, { useState, useRef, useEffect } from "react";
import {
    View,
    Text,
    TouchableOpacity,
    StyleSheet,
    Dimensions,
    ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Notifications from "expo-notifications";
import {
    configureNotifications,
    handleNotification,
    handleNotificationResponse,
} from "./services/notification";

const SCREEN_WIDTH = Dimensions.get("window").width;
const CIRCLE_SIZE = 24;
const BORDER_WIDTH = 2;
const COLORS = {
    blue: "#4388CC",
    yellow: "#FFCC33",
    grey: "#F0F0F0",
};

const StopWatchScreen = () => {
    // Add this at the top of TimerApp component
    const [timerCards, setTimerCards] = useState([
        {
            id: 1,
            selectedHours: 0,
            selectedMinutes: 0,
            selectedSeconds: 0,
            selectedMliSeconds: 0,
            activeTimer: null,
            interval: null,
            incrementedValues: {
                1: 1,
                5: 5,
                10: 10,
                15: 15,
                30: 30,
            },
        },
    ]);

    useEffect(() => {
        configureNotifications();

        // Set up notification listeners
        const notificationListener =
            Notifications.addNotificationReceivedListener(handleNotification);
        const responseListener =
            Notifications.addNotificationResponseReceivedListener(
                handleNotificationResponse
            );

        return () => {
            Notifications.removeNotificationSubscription(notificationListener);
            Notifications.removeNotificationSubscription(responseListener);
        };
    }, []);

    // Timer Increment
    const handleTimeIncrement = (time) => {
        setTimerCards((prevCards) => {
            return prevCards.map((card, index) => {
                if (index === 0) {
                    // Calculate new total time in milliseconds
                    let totalTime =
                        ((card.selectedHours * 60 + card.selectedMinutes) * 60 +
                            card.selectedSeconds) *
                            1000 +
                        card.selectedMliSeconds;
                    let newTime = totalTime + time * 60000; // Add time in milliseconds
                    if (newTime <= 0) {
                        return {
                            ...card,
                            selectedHours: 0,
                            selectedMinutes: 0,
                            selectedSeconds: 0,
                            selectedMliSeconds: 0,
                        };
                    } else {
                        // Convert back to hours, minutes, seconds, and milliseconds
                        let newHours = Math.floor(newTime / (1000 * 60 * 60));
                        let newMinutes = Math.floor(
                            (newTime % (1000 * 60 * 60)) / (1000 * 60)
                        );
                        let newSeconds = Math.floor(
                            (newTime % (1000 * 60)) / 1000
                        );
                        let newMilliseconds = newTime % 1000;
                        return {
                            ...card,
                            selectedHours: newHours,
                            selectedMinutes: newMinutes,
                            selectedSeconds: newSeconds,
                            selectedMliSeconds: newMilliseconds,
                        };
                    }
                }
                return card;
            });
        });
    };

    // Pause timer
    // Pause timer needs to update AsyncStorage
    const pauseTimer = async (cardId) => {
        try {
            const timerKey = `timer-${cardId}`;
            const timerData = await AsyncStorage.getItem(timerKey);
            if (timerData) {
                const timer = JSON.parse(timerData);
                await AsyncStorage.setItem(
                    timerKey,
                    JSON.stringify({
                        ...timer,
                        isPaused: true,
                    })
                );
            }
        } catch (error) {
            console.error("Error updating paused state:", error);
        }

        setTimerCards((prev) =>
            prev.map((card) => {
                if (card.id === cardId) {
                    if (card.interval) {
                        clearInterval(card.interval); // Stop the interval on pause
                    }
                    return {
                        ...card,
                        interval: null, // Remove the interval reference
                        activeTimer: {
                            ...card.activeTimer,
                            isPaused: true,
                        },
                    };
                }
                return card;
            })
        );
    };

    const resumeTimer = async (cardId) => {
        try {
            const timerKey = `timer-${cardId}`;
            const timerData = await AsyncStorage.getItem(timerKey);
            if (timerData) {
                const timer = JSON.parse(timerData);
                await AsyncStorage.setItem(
                    timerKey,
                    JSON.stringify({
                        ...timer,
                        isPaused: false,
                    })
                );
            }
        } catch (error) {
            console.error("Error updating paused state:", error);
        }

        setTimerCards((prev) =>
            prev.map((card) => {
                if (card.id === cardId) {
                    if (!card.activeTimer.isPaused) return card; // Prevent duplicate intervals

                    const interval = setInterval(() => {
                        setTimerCards((cards) =>
                            cards.map((c) => {
                                if (c.id === cardId) {
                                    let newTime =
                                        c.selectedHours * 3600000 +
                                        c.selectedMinutes * 60000 +
                                        c.selectedSeconds * 1000 +
                                        c.selectedMliSeconds -
                                        50;

                                    if (newTime <= 0) {
                                        clearInterval(interval); // Stop timer at 0
                                        newTime = 0;
                                        Notifications.scheduleNotificationAsync(
                                            {
                                                content: {
                                                    title: "Timer Complete!",
                                                    body: `Your timer is done`,
                                                    sound: true,
                                                    priority: "high",
                                                    badge: 1,
                                                },
                                                trigger: null, // Show immediately
                                            }
                                        )
                                            .then((res) => {
                                                console.log("here : ");
                                            })
                                            .catch((err) => {
                                                console.log("err : ", err);
                                            });
                                    }

                                    return {
                                        ...c,
                                        selectedHours: Math.floor(
                                            newTime / 3600000
                                        ),
                                        selectedMinutes: Math.floor(
                                            (newTime % 3600000) / 60000
                                        ),
                                        selectedSeconds: Math.floor(
                                            (newTime % 60000) / 1000
                                        ),
                                        selectedMliSeconds: newTime % 1000,
                                        interval: interval,
                                        activeTimer: {
                                            ...c.activeTimer,
                                            isPaused: false,
                                        },
                                    };
                                }
                                return c;
                            })
                        );
                    }, 50);

                    return {
                        ...card,
                        interval: interval,
                        activeTimer: { ...card.activeTimer, isPaused: false },
                    };
                }
                return card;
            })
        );
    };

    // Handle Play Button Press
    const handlePlayPress = (cardId) => {
        console.log(cardId);
        setTimerCards((prevCards) =>
            prevCards.map((c) => {
                if (c.id === cardId) {
                    const totalMliSeconds =
                        c.selectedHours * 3600000 +
                        c.selectedMinutes * 60000 +
                        c.selectedSeconds * 1000 +
                        c.selectedMliSeconds;
                    if (totalMliSeconds <= 0) {
                        return c;
                    }
                    if (c.interval) {
                        clearInterval(c.interval);
                    }
                    const interval = setInterval(() => {
                        setTimerCards((cards) =>
                            cards.map((card) => {
                                if (card.id === cardId) {
                                    let newTime =
                                        card.selectedHours * 3600000 +
                                        card.selectedMinutes * 60000 +
                                        card.selectedSeconds * 1000 +
                                        card.selectedMliSeconds -
                                        50;

                                    if (newTime <= 0) {
                                        clearInterval(card.interval); // Stop interval when reaching 0
                                        newTime = 0;
                                        Notifications.scheduleNotificationAsync(
                                            {
                                                content: {
                                                    title: "Timer Complete!",
                                                    body: `Your timer is done`,
                                                    sound: true,
                                                    priority: "high",
                                                    badge: 1,
                                                },
                                                trigger: null, // Show immediately
                                            }
                                        )
                                            .then((res) => {
                                                console.log("here : ");
                                            })
                                            .catch((err) => {
                                                console.log("err : ", err);
                                            });
                                    }

                                    return {
                                        ...card,
                                        selectedHours: Math.floor(
                                            newTime / 3600000
                                        ),
                                        selectedMinutes: Math.floor(
                                            (newTime % 3600000) / 60000
                                        ),
                                        selectedSeconds: Math.floor(
                                            (newTime % 60000) / 1000
                                        ),
                                        selectedMliSeconds: newTime % 1000,
                                        interval: interval,
                                        activeTimer: {
                                            ...card.activeTimer,
                                            isPaused: false,
                                        },
                                    };
                                }
                                return card;
                            })
                        );
                    }, 50);

                    return { ...c, interval: interval }; // Store interval on the card
                }
                return c;
            })
        );
    };

    // Delete card
    const deleteCard = async (cardId) => {
        if (timerCards[0].interval) {
            clearInterval(timerCards[0].interval);
        }
        setTimerCards([
            {
                id: 1,
                selectedHours: 0,
                selectedMinutes: 0,
                selectedSeconds: 0,
                selectedMliSeconds: 0,
                activeTimer: {
                    isPaused: true,
                },
                interval: null,
                incrementedValues: {
                    1: 1,
                    5: 5,
                    10: 10,
                    15: 15,
                    30: 30,
                },
            },
        ]);
        // Clean up any running intervals or background tasks for this timer
    };

    return (
        <SafeAreaView style={styles.container}>
            <ScrollView contentContainerStyle={styles.scrollContent}>
                <View key={timerCards[0].id} style={styles.timerCard}>
                    {/* Timer Display */}
                    <View style={styles.timerContainer}>
                        <View style={styles.timeContainer}>
                            <Text style={styles.timeText}>hr</Text>
                            <Text style={styles.timeText}>
                                {timerCards[0].selectedHours}
                            </Text>
                        </View>
                        <View style={styles.timeContainer}>
                            <Text style={styles.timeText}>min</Text>
                            <Text style={styles.timeText}>
                                {timerCards[0].selectedMinutes}
                            </Text>
                        </View>
                        <View style={styles.timeContainer}>
                            <Text style={styles.timeText}>sec</Text>
                            <Text style={styles.timeText}>
                                {timerCards[0].selectedSeconds}
                            </Text>
                        </View>
                        <View style={styles.timeContainer}>
                            <Text style={styles.timeText}>milsec</Text>
                            <Text style={styles.timeText}>
                                {timerCards[0].selectedMliSeconds / 10 < 10
                                    ? "0" +
                                      timerCards[0].selectedMliSeconds / 10
                                    : timerCards[0].selectedMliSeconds / 10}
                            </Text>
                        </View>
                    </View>
                    <Text style={styles.ringEvery}> RING EVERY</Text>
                    {/* Bottom Controls */}
                    <View style={styles.bottomControls}>
                        {Object.entries(timerCards[0].incrementedValues).map(
                            ([baseTime, currentValue]) => (
                                <View
                                    key={baseTime}
                                    style={styles.incrementControl}
                                >
                                    <TouchableOpacity
                                        onPress={() =>
                                            handleTimeIncrement(baseTime * -1)
                                        }
                                        style={styles.incrementButton}
                                    >
                                        <Text
                                            style={styles.incrementButtonText}
                                        >
                                            -
                                        </Text>
                                    </TouchableOpacity>

                                    <TouchableOpacity
                                        onPress={() => {}}
                                        style={styles.timerButton}
                                    >
                                        <Text style={styles.buttonText}>
                                            {currentValue}
                                        </Text>
                                    </TouchableOpacity>

                                    <TouchableOpacity
                                        onPress={() =>
                                            handleTimeIncrement(baseTime)
                                        }
                                        style={styles.incrementButton}
                                    >
                                        <Text
                                            style={styles.incrementButtonText}
                                        >
                                            +
                                        </Text>
                                    </TouchableOpacity>
                                </View>
                            )
                        )}
                    </View>

                    {/* Player Controls */}

                    {/* Player Controls */}
                    <View style={styles.playerControls}>
                        {timerCards[0].activeTimer ? (
                            timerCards[0].activeTimer.isPaused ? (
                                <TouchableOpacity
                                    style={styles.resumeButton}
                                    onPress={() =>
                                        resumeTimer(timerCards[0].id)
                                    }
                                >
                                    <View style={styles.playTriangle} />
                                </TouchableOpacity>
                            ) : (
                                <TouchableOpacity
                                    style={styles.pauseButton}
                                    onPress={() => pauseTimer(timerCards[0].id)}
                                >
                                    <View style={styles.pauseBars}>
                                        <View style={styles.pauseBar} />
                                        <View style={styles.pauseBar} />
                                    </View>
                                </TouchableOpacity>
                            )
                        ) : (
                            <TouchableOpacity
                                style={styles.playButton}
                                onPress={() =>
                                    handlePlayPress(timerCards[0].id)
                                }
                            >
                                <View style={styles.playTriangle} />
                            </TouchableOpacity>
                        )}

                        <TouchableOpacity
                            onPress={() => deleteCard(timerCards[0].id)}
                            style={styles.stopButton}
                        />
                    </View>
                </View>
            </ScrollView>
        </SafeAreaView>
    );
};

export const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: "white",
    },
    scrollContent: {
        alignItems: "center",
        paddingVertical: 20,
    },
    timerCard: {
        alignItems: "center",
        width: SCREEN_WIDTH,
        maxWidth: 400,
        marginBottom: 20,
    },
    timerContainer: {
        width: 300,
        height: 100,
        backgroundColor: COLORS.yellow,
        marginTop: 100,
        marginBottom: 80,
        flexDirection: "row",
        justifyContent: "space-around",
    },
    timeContainer: {
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
    },
    timeText: {
        fontSize: 24,
        color: COLORS.blue,
        fontWeight: "bold",
    },
    title: {
        fontSize: 20,
        fontWeight: "bold",
        color: COLORS.blue,
        marginBottom: 10,
    },
    quickAccessBar: {
        width: "100%",
        backgroundColor: COLORS.grey,
        flexDirection: "row",
        justifyContent: "space-around",
        alignItems: "center",
        padding: 10,
    },
    timerCircle: {
        width: 300,
        height: 300,
        marginVertical: 20,
    },

    timerCircle: {
        width: 300,
        height: 300,
        marginVertical: 20,
        justifyContent: "center",
        alignItems: "center",
    },
    countdownArc: {
        position: "absolute",
        width: 300,
        height: 300,
    },

    // countdownText: {
    //   fontSize: 24,
    //   fontWeight: 'bold',
    //   color: COLORS.blue,
    //   marginBottom: 10,
    // },

    countdownDisplay: {
        position: "absolute",
        top: "25%", // Adjust this value to position the text block where you want it
        alignItems: "center",
        gap: 5,
    },

    hoursText: {
        fontSize: 24,
        fontWeight: "bold",
        color: COLORS.blue,
        textAlign: "center",
    },

    minSecText: {
        fontSize: 20,
        fontWeight: "bold",
        color: COLORS.blue,
        textAlign: "center",
        marginBottom: 15, // Space between text and progress bar
    },

    linearProgress: {
        width: 175,
        height: 10,
        borderRadius: 5,
        backgroundColor: "#FFCC33",
        overflow: "hidden",
        flexDirection: "row",
        position: "absolute",
        top: "48%", // Adjust this to position the progress bar
    },

    // Update these styles in your StyleSheet

    centerDisplay: {
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        alignItems: "center",
        justifyContent: "center",
        gap: 10, // Add spacing between elements
    },

    countdownText: {
        fontSize: 24,
        fontWeight: "bold",
        color: COLORS.blue,
    },

    pauseButton: {
        width: 48,
        height: 48,
        backgroundColor: "#EAB308",
        borderRadius: 8,
        alignItems: "center",
        justifyContent: "center",
    },
    pauseBars: {
        flex: 1,
        flexDirection: "row",
        justifyContent: "space-around",
        alignItems: "center",
        paddingHorizontal: 10,
    },
    pauseBar: {
        width: 5,
        height: 25,
        backgroundColor: "white",
    },
    resumeButton: {
        width: 48,
        height: 48,
        backgroundColor: "#22C55E",
        borderRadius: 8,
        alignItems: "center",
        justifyContent: "center",
    },

    // linearProgress: {
    //   width: 200,
    //   height: 10,
    //   borderRadius: 5,
    //   backgroundColor: '#FFCC33',
    //   overflow: 'hidden', // Ensure the fill doesn't exceed container
    //   flexDirection: 'row',
    //   position: 'absolute',
    //   top: '50%', // Center vertically
    //   transform: [{ translateY: -5 }], // Half of height to perfect center
    // },

    linearProgressBackground: {
        height: "100%",
        borderRadius: 5,
        backgroundColor: "#0A612E",
    },

    linearProgressFill: {
        position: "absolute",
        left: 0,
        height: "100%",
        borderRadius: 5,
        backgroundColor: COLORS.blue,
    },

    // linearProgress: {
    //   width: 200,
    //   height: 10,
    //   borderRadius: 5,
    //   backgroundColor: '#FFCC33',
    //   marginBottom: 10,
    //   flexDirection: 'row',
    // },
    // linearProgressFill: {
    //   position: 'absolute',
    //   left: 0,
    //   height: '100%',
    //   borderRadius: 5,
    //   backgroundColor: COLORS.blue,
    // },
    // linearProgressBackground: {
    //   height: '100%',
    //   borderRadius: 5,
    //   backgroundColor: COLORS.blue,
    // },

    // linearProgress: {
    //   width: 200,
    //   height: 10,
    //   borderRadius: 5,
    //   backgroundColor: '#FFCC33',
    //   marginBottom: 20,
    // },
    // linearProgressFill: {
    //   height: '100%',
    //   borderRadius: 5,
    //   backgroundColor: COLORS.blue,
    // },
    // selectedDuration: {
    //   width: 80,
    //   height: 80,
    //   borderRadius: 40,
    //   backgroundColor: '#FFCC33',
    //   justifyContent: 'center',
    //   alignItems: 'center',
    // },

    selectedDurationWrapper: {
        flex: 1,
        justifyContent: "center",
        alignItems: "center",
    },
    selectedDuration: {
        width: 80,
        height: 80,
        borderRadius: 40,
        backgroundColor: "#FFCC33",
        justifyContent: "center",
        alignItems: "center",
        marginTop: 100, // Adjust the value as needed
    },

    selectedDurationText: {
        fontSize: 24,
        fontWeight: "bold",
        color: COLORS.blue,
    },

    outerCircle: {
        position: "absolute",
        width: 300,
        height: 300,
        borderRadius: 150,
        borderWidth: BORDER_WIDTH,
        borderColor: COLORS.blue,
    },
    innerCircle: {
        position: "absolute",
        top: 50,
        left: 50,
        width: 200,
        height: 200,
        borderRadius: 100,
        borderWidth: BORDER_WIDTH,
        borderColor: COLORS.blue,
    },
    clockNumber: {
        width: CIRCLE_SIZE,
        height: CIRCLE_SIZE,
        borderRadius: CIRCLE_SIZE / 2,
        backgroundColor: COLORS.yellow,
        borderWidth: BORDER_WIDTH,
        borderColor: COLORS.blue,
        alignItems: "center",
        justifyContent: "center",
    },
    clockNumberText: {
        color: COLORS.blue,
        fontWeight: "bold",
    },
    // centerDisplay: {
    //   position: 'absolute',
    //   top: 0,
    //   left: 0,
    //   right: 0,
    //   bottom: 0,
    //   alignItems: 'center',
    //   justifyContent: 'center',
    // },
    timerText: {
        fontSize: 24,
        fontWeight: "bold",
        color: COLORS.blue,
    },
    timeSelector: {
        backgroundColor: COLORS.yellow,
        padding: 8,
        borderRadius: 8,
    },
    selectorRow: {
        flexDirection: "row",
        justifyContent: "space-between",
        marginBottom: 8,
    },
    selectorLabel: {
        color: COLORS.blue,
        fontWeight: "bold",
        flex: 1,
        textAlign: "center",
    },
    wheelsContainer: {
        flexDirection: "row",
        justifyContent: "space-between",
        gap: 8,
    },
    selectorContainer: {
        width: CIRCLE_SIZE,
        height: CIRCLE_SIZE,
        backgroundColor: "white",
        borderWidth: BORDER_WIDTH,
        borderColor: COLORS.blue,
        borderRadius: 4,
        overflow: "hidden",
    },
    selectorItem: {
        alignItems: "center",
        justifyContent: "center",
    },
    selectorText: {
        fontSize: 16,
        color: "#666",
    },
    selectedItem: {
        backgroundColor: "rgba(67, 136, 204, 0.1)",
    },
    selectedText: {
        color: COLORS.blue,
        fontWeight: "bold",
    },
    ringEvery: {
        fontSize: 18,
        fontWeight: 700,
        color: COLORS.blue,
        marginRight: 250,
        marginBottom: 10,
    },
    bottomControls: {
        width: "90%",
        backgroundColor: COLORS.grey,
        flexDirection: "row",
        justifyContent: "space-around",
        alignItems: "center",
        paddingTop: 5,
        paddingBottom: 5,
    },
    incrementControl: {
        flexDirection: "row",
        alignItems: "center",
    },
    incrementButton: {
        paddingHorizontal: 6,
    },
    incrementButtonText: {
        fontSize: 24,
        color: COLORS.blue,
        fontWeight: "bold",
    },
    timerButton: {
        width: CIRCLE_SIZE,
        height: CIRCLE_SIZE,
        borderRadius: CIRCLE_SIZE / 2,
        backgroundColor: COLORS.yellow,
        borderWidth: BORDER_WIDTH,
        borderColor: COLORS.blue,
        alignItems: "center",
        justifyContent: "center",
    },
    buttonText: {
        color: COLORS.blue,
        fontWeight: "bold",
    },
    playerControls: {
        flexDirection: "row",
        justifyContent: "center",
        alignItems: "center",
        marginVertical: 20,
        gap: 100,
    },
    playButton: {
        width: 48,
        height: 48,
        backgroundColor: "#22C55E",
        borderRadius: 8,
        alignItems: "center",
        justifyContent: "center",
    },
    playTriangle: {
        width: 0,
        height: 0,
        backgroundColor: "transparent",
        borderStyle: "solid",
        borderLeftWidth: 20,
        borderTopWidth: 12,
        borderBottomWidth: 12,
        borderTopColor: "transparent",
        borderBottomColor: "transparent",
        borderLeftColor: "white",
        marginLeft: 4,
    },
    stopButton: {
        width: 48,
        height: 48,
        backgroundColor: "#EF4444",
        borderRadius: 8,
    },
    resetButton: {
        width: 48,
        height: 48,
        borderRadius: 24,
        backgroundColor: COLORS.blue,
        alignItems: "center",
        justifyContent: "center",
    },
    resetButtonText: {
        color: "white",
        fontSize: 18,
        fontWeight: "bold",
    },
    divider: {
        width: "100%",
        height: 4,
        backgroundColor: COLORS.yellow,
    },
    addButton: {
        width: 56,
        height: 56,
        borderRadius: 28,
        backgroundColor: COLORS.yellow,
        alignItems: "center",
        justifyContent: "center",
        marginVertical: 16,
    },
    addButtonText: {
        fontSize: 32,
        color: COLORS.blue,
        fontWeight: "bold",
    },

    selectorContainer: {
        width: CIRCLE_SIZE,
        height: CIRCLE_SIZE,
        backgroundColor: "white",
        borderWidth: BORDER_WIDTH,
        borderColor: COLORS.blue,
        borderRadius: 4,
        overflow: "hidden",
    },
    selectorItem: {
        alignItems: "center",
        justifyContent: "center",
    },
    selectorText: {
        fontSize: 16,
        color: "#666",
    },
    selectedItem: {
        backgroundColor: "rgba(67, 136, 204, 0.1)",
    },
    selectedText: {
        color: COLORS.blue,
        fontWeight: "bold",
    },

    selectorContainer: {
        width: CIRCLE_SIZE,
        height: CIRCLE_SIZE * 1.5,
        backgroundColor: "white",
        borderWidth: BORDER_WIDTH,
        borderColor: COLORS.blue,
        borderRadius: 4,
        overflow: "hidden",
        flexDirection: "column",
        justifyContent: "space-between",
    },
    arrowButton: {
        height: CIRCLE_SIZE * 0.5,
        width: "100%",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(67, 136, 204, 0.1)",
        padding: 0,
    },
    arrowText: {
        color: COLORS.blue,
        fontSize: 8,
        lineHeight: 8,
        height: 8,
    },
    numberDisplay: {
        height: CIRCLE_SIZE * 0.5,
        width: "100%",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "white",
        padding: 0,
    },
    numberText: {
        fontSize: 16,
        color: COLORS.blue,
        fontWeight: "bold",
        lineHeight: 16,
    },
});

export default StopWatchScreen;
