import React, { useState, useEffect, useRef } from "react";
import {
    View,
    Text,
    TouchableOpacity,
    StyleSheet,
    Dimensions,
    ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Circle } from "react-native-svg";
import Svg from "react-native-svg";
import * as Notifications from "expo-notifications";
import { AppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as BackgroundFetch from "expo-background-fetch";
import * as TaskManager from "expo-task-manager";
import {
    cancelTimerNotification,
    configureNotifications,
    handleNotification,
    handleNotificationResponse,
} from "./services/notification";
import { onTimerComplete, restoreTimers, startTimer } from "./services/timer";

const BACKGROUND_FETCH_TASK = "background-fetch-task";
const RECENT_TIMERS_STORAGE_KEY = "recent-timers";

TaskManager.defineTask(BACKGROUND_FETCH_TASK, async () => {
    try {
        const now = Date.now();

        // Get all active timers
        const keys = await AsyncStorage.getAllKeys();
        const timerKeys = keys.filter((key) => key.startsWith("timer-"));
        const timerData = await AsyncStorage.multiGet(timerKeys);

        let updatedAny = false;

        for (const [key, value] of timerData) {
            if (!value) continue;

            const timer = JSON.parse(value);
            const cardId = parseInt(key.split("-")[1]);

            // Only process non-paused timers
            if (!timer.isPaused) {
                const secondsLeft = Math.max(
                    0,
                    Math.floor((timer.endTime - now) / 1000)
                );

                if (secondsLeft > 0) {
                    // Update timer state
                    await AsyncStorage.setItem(
                        key,
                        JSON.stringify({
                            ...timer,
                            secondsLeft,
                            lastUpdated: now,
                        })
                    );
                    updatedAny = true;

                    // Schedule next notification
                    await Notifications.scheduleNotificationAsync({
                        content: {
                            title: "Timer Running",
                            body: `${Math.ceil(
                                secondsLeft / 60
                            )} minutes remaining`,
                            data: { cardId },
                        },
                        trigger: { seconds: 60 }, // Update notification every minute
                    });
                } else {
                    // Timer completed
                    await AsyncStorage.removeItem(key);
                    updatedAny = true;

                    // Show completion notification
                    await Notifications.scheduleNotificationAsync({
                        content: {
                            title: "Timer Complete!",
                            body: `Your timer is done`,
                            sound: true,
                            priority: "high",
                            badge: 1,
                        },
                        trigger: null, // Show immediately
                    });
                }
            }
        }

        // Return success/failure without using BackgroundFetch.Result
        return updatedAny ? 1 : 0; // 1 for success, 0 for no data
    } catch (error) {
        console.error("[Background Fetch] Error:", error);
        return -1; // -1 for failure
    }
});

const SCREEN_WIDTH = Dimensions.get("window").width;
const CIRCLE_SIZE = 34;
const BORDER_WIDTH = 2;
const COLORS = {
    blue: "#4388CC",
    yellow: "#FFCC33",
    grey: "#F0F0F0",
};

// TimeSelector Component with infinite scroll
// TimeSelector Component with infinite scroll

const TimeSelector = ({ type, max, value, setValue, cardId }) => {
    const handleIncrement = () => {
        const newValue = (value + 1) % max;
        setValue(cardId, type, newValue);
    };

    const handleDecrement = () => {
        const newValue = value - 1 < 0 ? max - 1 : value - 1;
        setValue(cardId, type, newValue);
    };

    return (
        <View style={styles.selectorContainer}>
            {/* Up Arrow Button */}
            <TouchableOpacity
                onPress={handleIncrement}
                style={styles.arrowButton}
            >
                <Text style={styles.arrowText}>▲</Text>
            </TouchableOpacity>

            {/* Number Display */}
            <View style={styles.numberDisplay}>
                <Text style={styles.numberText}>
                    {value.toString().padStart(2, "0")}
                </Text>
            </View>

            {/* Down Arrow Button */}
            <TouchableOpacity
                onPress={handleDecrement}
                style={styles.arrowButton}
            >
                <Text style={styles.arrowText}>▼</Text>
            </TouchableOpacity>
        </View>
    );
};

const CountTimerScreen = () => {
    // Add this at the top of TimerApp component
    const appState = useRef(AppState.currentState);
    // States
    const [globalRecentTimers, setGlobalRecentTimers] = useState([
        15, 30, 5, 10, 1, 15, 30, 5, 
    ]);
    const [timerCards, setTimerCards] = useState([
        {
            id: 1,
            selectedHours: 0,
            selectedMinutes: 0,
            selectedSeconds: 0,
            activeTimer: null,
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

    useEffect(() => {
        const restoreRecentTimers = async () => {
            try {
                const savedTimers = await AsyncStorage.getItem(
                    RECENT_TIMERS_STORAGE_KEY
                );
                if (savedTimers) {
                    setGlobalRecentTimers(JSON.parse(savedTimers));
                }
            } catch (error) {
                console.error("Error restoring recent timers:", error);
            }
        };

        restoreRecentTimers();
    }, []);

    useEffect(() => {
        const registerTasks = async () => {
            try {
                // First unregister any existing task
                try {
                    await BackgroundFetch.unregisterTaskAsync(
                        BACKGROUND_FETCH_TASK
                    );
                } catch (err) {
                    // Task might not exist yet
                }

                // Register task with different options
                await BackgroundFetch.registerTaskAsync(BACKGROUND_FETCH_TASK, {
                    minimumInterval: 60, // One minute minimum
                    stopOnTerminate: false,
                    startOnBoot: true,
                });
            } catch (error) {
                console.error("Failed to register background task:", error);
            }
        };

        registerTasks();
    }, []);

    useEffect(() => {
        restoreTimers(setTimerCards);

        const subscription = AppState.addEventListener(
            "change",
            async (nextAppState) => {
                if (
                    appState.current.match(/inactive|background/) &&
                    nextAppState === "active"
                ) {
                    // App has come to foreground - restore all timer states
                    const keys = await AsyncStorage.getAllKeys();
                    const timerKeys = keys.filter((key) =>
                        key.startsWith("timer-")
                    );
                    const timerData = await AsyncStorage.multiGet(timerKeys);

                    const now = Date.now();

                    // Update all timer cards
                    setTimerCards((prev) =>
                        prev.map((card) => {
                            const timerKey = `timer-${card.id}`;
                            const timerDataEntry = timerData.find(
                                ([key]) => key === timerKey
                            );

                            if (timerDataEntry) {
                                const timer = JSON.parse(timerDataEntry[1]);
                                const secondsLeft = Math.max(
                                    0,
                                    Math.floor((timer.endTime - now) / 1000)
                                );

                                return {
                                    ...card,
                                    activeTimer: {
                                        ...timer,
                                        secondsLeft,
                                    },
                                };
                            }
                            return card;
                        })
                    );
                }
                appState.current = nextAppState;
            }
        );

        return () => {
            subscription.remove();
        };
    }, []);

    // Handle Play Button Press
    const handlePlayPress = (cardId) => {
        const card = timerCards.find((c) => c.id === cardId);
        const totalSeconds =
            card.selectedHours * 3600 +
            card.selectedMinutes * 60 +
            card.selectedSeconds;
        if (totalSeconds > 0) {
            startTimer(
                cardId,
                totalSeconds / 60,
                globalRecentTimers,
                setGlobalRecentTimers,
                timerCards,
                setTimerCards
            );
            setTimerCards((prev) =>
                prev.map((c) =>
                    c.id === cardId
                        ? {
                              ...c,
                              selectedHours: 0,
                              selectedMinutes: 0,
                              selectedSeconds: 0,
                          }
                        : c
                )
            );
        }
    };

    // Handle increment/decrement
    const handleIncrement = (cardId, baseTime, amount) => {
        setTimerCards((prev) =>
            prev.map((card) => {
                if (card.id === cardId) {
                    const newValue = Math.max(
                        1,
                        card.incrementedValues[baseTime] + amount
                    );
                    const updatedCard = {
                        ...card,
                        incrementedValues: {
                            ...card.incrementedValues,
                            [baseTime]: newValue,
                        },
                    };

                    // Start timer immediately with new value
                    startTimer(
                        cardId,
                        newValue,
                        globalRecentTimers,
                        setGlobalRecentTimers,
                        timerCards,
                        setTimerCards
                    );

                    return updatedCard;
                }
                return card;
            })
        );
    };

    // Add new timer card
    const addTimerCard = (afterId) => {
        setTimerCards((prev) => {
            const index = prev.findIndex((card) => card.id === afterId);
            const newCard = {
                id: Math.max(...prev.map((c) => c.id)) + 1,
                selectedHours: 0,
                selectedMinutes: 0,
                selectedSeconds: 0,
                activeTimer: null,
                incrementedValues: {
                    1: 1,
                    5: 5,
                    10: 10,
                    15: 15,
                    30: 30,
                },
            };

            return [
                ...prev.slice(0, index + 1),
                newCard,
                ...prev.slice(index + 1),
            ];
        });
    };

    // Delete card
    // Delete card
    const deleteCard = async (cardId) => {
        // First cancel any notifications
        await cancelTimerNotification(cardId);

        // Remove from AsyncStorage
        try {
            await AsyncStorage.removeItem(`timer-${cardId}`);
        } catch (error) {
            console.error("Error removing timer from storage:", error);
        }

        setTimerCards((prev) => {
            if (prev.length === 1) {
                // If there is only one card, reset its values and stop the timer
                return [
                    {
                        id: prev[0].id,
                        selectedHours: 0,
                        selectedMinutes: 0,
                        selectedSeconds: 0,
                        activeTimer: null,
                        incrementedValues: {
                            1: 1,
                            5: 5,
                            10: 10,
                            15: 15,
                            30: 30,
                        },
                    },
                ];
            } else {
                // If there are multiple cards, stop the timer and delete the card
                return prev.filter((card) => card.id !== cardId);
            }
        });

        // Clean up any running intervals or background tasks for this timer
    };
    // Timer countdown effect
    // Modify timer countdown effect to handle completion
    useEffect(() => {
        const intervals = timerCards.map((card) => {
            if (
                card.activeTimer &&
                card.activeTimer.secondsLeft > 0 &&
                !card.activeTimer.isPaused
            ) {
                return setInterval(() => {
                    setTimerCards((prev) =>
                        prev.map((c) => {
                            if (c.id === card.id && c.activeTimer) {
                                const newSecondsLeft =
                                    c.activeTimer.secondsLeft - 1;
                                if (newSecondsLeft <= 0) {
                                    // Timer completed, trigger notification
                                    onTimerComplete(card.id, timerCards);
                                }
                                return {
                                    ...c,
                                    activeTimer: {
                                        ...c.activeTimer,
                                        secondsLeft: newSecondsLeft,
                                    },
                                };
                            }
                            return c;
                        })
                    );
                }, 1000);
            }
            return null;
        });

        return () =>
            intervals.forEach(
                (interval) => interval && clearInterval(interval)
            );
    }, [timerCards]);

    // Render clock numbers
    const renderClockNumbers = (card) => {
        if (card.activeTimer) {
            // Render countdown progress arc
            const radius = 125;
            const circumference = 2 * Math.PI * radius;
            const progressOffset =
                circumference *
                (1 -
                    card.activeTimer.secondsLeft /
                        (card.activeTimer.minutes * 60));

            return (
                <View style={styles.countdownArc}>
                    <Svg width={300} height={300}>
                        <Circle
                            cx={150}
                            cy={150}
                            r={radius}
                            stroke="#0A612E"
                            strokeWidth={50}
                            strokeDasharray={circumference}
                            strokeDashoffset={progressOffset}
                            fill="none"
                            strokeLinecap="round"
                            transform={`rotate(-90, 150, 150)`}
                        />
                    </Svg>
                </View>
            );
        } else {
            return Array(12)
                .fill(0)
                .map((_, i) => {
                    const value = (i + 1) * 5;
                    const angle = ((i + 1) / 12) * 2 * Math.PI - Math.PI / 2;
                    const radius = 125;
                    const x = 150 + radius * Math.cos(angle);
                    const y = 150 + radius * Math.sin(angle);

                    return (
                        <TouchableOpacity
                            key={i}
                            onPress={() =>
                                startTimer(
                                    card.id,
                                    value,
                                    globalRecentTimers,
                                    setGlobalRecentTimers,
                                    timerCards,
                                    setTimerCards
                                )
                            }
                            style={[
                                styles.clockNumber,
                                {
                                    position: "absolute",
                                    left: x - CIRCLE_SIZE / 2,
                                    top: y - CIRCLE_SIZE / 2,
                                    zIndex: 20,
                                },
                            ]}
                        >
                            <Text style={styles.clockNumberText}>{value}</Text>
                        </TouchableOpacity>
                    );
                });
        }
    };

    // Render a single timer card
    const renderTimerCard = (card) => {
        return (
            <View key={card.id} style={styles.timerCard}>
                <Text style={styles.title}>LAST TIMERS (CLICK)</Text>

                {/* Quick Access Timer Bar */}
                <View style={styles.quickAccessBar}>
                    {globalRecentTimers.map((time, index) => (
                        <TouchableOpacity
                            key={index}
                            onPress={() =>
                                startTimer(
                                    card.id,
                                    time,
                                    globalRecentTimers,
                                    setGlobalRecentTimers,
                                    timerCards,
                                    setTimerCards
                                )
                            }
                            style={styles.timerButton}
                        >

                            
                            <Text style={styles.buttonText}>{time}</Text>
                        </TouchableOpacity>
                    ))}
                </View>

                {/* Main Timer Circle */}
                <View style={styles.timerCircle}>
                    <View style={styles.outerCircle} />
                    <View style={styles.innerCircle} />
                    {renderClockNumbers(card)}

                    {/* Center Display */}
                    {/* Center Display */}

                    <View style={styles.centerDisplay}>
                        {card.activeTimer ? (
                            <>
                                <View style={styles.countdownDisplay}>
                                    {/* Hours display */}
                                    <Text style={styles.hoursText}>
                                        {Math.floor(
                                            card.activeTimer.secondsLeft / 3600
                                        ) > 0 &&
                                            `${Math.floor(
                                                card.activeTimer.secondsLeft /
                                                    3600
                                            )} hr`}
                                    </Text>

                                    {/* Minutes and seconds on next line */}
                                    <Text style={styles.minSecText}>
                                        {Math.floor(
                                            (card.activeTimer.secondsLeft %
                                                3600) /
                                                60
                                        ) > 0 &&
                                            `${Math.floor(
                                                (card.activeTimer.secondsLeft %
                                                    3600) /
                                                    60
                                            )} min `}
                                        {card.activeTimer.secondsLeft % 60 >
                                            0 &&
                                            `${
                                                card.activeTimer.secondsLeft %
                                                60
                                            } sec`}
                                    </Text>
                                </View>

                                <View style={styles.linearProgress}>
                                    <View
                                        style={[
                                            styles.linearProgressBackground,
                                            {
                                                width: `${
                                                    (card.activeTimer
                                                        .secondsLeft /
                                                        (card.activeTimer
                                                            .minutes *
                                                            60)) *
                                                    100
                                                }%`,
                                            },
                                        ]}
                                    />
                                    <View style={styles.linearProgressFill} />
                                </View>

                                <View style={styles.selectedDurationWrapper}>
                                    <View style={styles.selectedDuration}>
                                        <Text
                                            style={styles.selectedDurationText}
                                        >
                                            {Math.round(card.activeTimer.minutes)}
                                        </Text>
                                    </View>
                                </View>
                            </>
                        ) : (
                            <View style={styles.timeSelector}>
                                <View style={styles.selectorRow}>
                                    <Text style={styles.selectorLabel}>HR</Text>
                                    <Text style={styles.selectorLabel}>
                                        MIN
                                    </Text>
                                    <Text style={styles.selectorLabel}>
                                        SEC
                                    </Text>
                                </View>
                                <View style={styles.wheelsContainer}>
                                    <TimeSelector
                                        type="selectedHours"
                                        max={24}
                                        value={card.selectedHours}
                                        cardId={card.id}
                                        setValue={(cardId, type, value) => {
                                            setTimerCards((prev) =>
                                                prev.map((c) =>
                                                    c.id === cardId
                                                        ? {
                                                              ...c,
                                                              [type]: value,
                                                          }
                                                        : c
                                                )
                                            );
                                        }}
                                    />
                                    <TimeSelector
                                        type="selectedMinutes"
                                        max={60}
                                        value={card.selectedMinutes}
                                        cardId={card.id}
                                        setValue={(cardId, type, value) => {
                                            setTimerCards((prev) =>
                                                prev.map((c) =>
                                                    c.id === cardId
                                                        ? {
                                                              ...c,
                                                              [type]: value,
                                                          }
                                                        : c
                                                )
                                            );
                                        }}
                                    />
                                    <TimeSelector
                                        type="selectedSeconds"
                                        max={60}
                                        value={card.selectedSeconds}
                                        cardId={card.id}
                                        setValue={(cardId, type, value) => {
                                            setTimerCards((prev) =>
                                                prev.map((c) =>
                                                    c.id === cardId
                                                        ? {
                                                              ...c,
                                                              [type]: value,
                                                          }
                                                        : c
                                                )
                                            );
                                        }}
                                    />
                                </View>
                            </View>
                        )}
                    </View>
                </View>

                {/* Bottom Controls */}
                <View style={styles.bottomControls}>
                    {Object.entries(card.incrementedValues).map(
                        ([baseTime, currentValue]) => (
                            <View
                                key={baseTime}
                                style={styles.incrementControl}
                            >
                                <TouchableOpacity
                                    onPress={() =>
                                        handleIncrement(card.id, baseTime, -1)
                                    }
                                    style={styles.incrementButton}
                                >
                                    <Text style={styles.incrementButtonText}>
                                        -
                                    </Text>
                                </TouchableOpacity>

                                <TouchableOpacity
                                    onPress={() =>
                                        startTimer(
                                            card.id,
                                            currentValue,
                                            globalRecentTimers,
                                            setGlobalRecentTimers,
                                            timerCards,
                                            setTimerCards
                                        )
                                    }
                                    style={styles.timerButton}
                                >
                                
                                    <Text style={styles.buttonText}>
                                        {currentValue}
                                    </Text>
                                </TouchableOpacity>

                                <TouchableOpacity
                                    onPress={() =>
                                        handleIncrement(card.id, baseTime, 1)
                                    }
                                    style={styles.incrementButton}
                                >
                                    <Text style={styles.incrementButtonText}>
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
                    {card.activeTimer ? (
                        card.activeTimer.isPaused ? (
                            <TouchableOpacity
                                style={styles.resumeButton}
                                onPress={() =>
                                    resumeTimer(card.id, setTimerCards)
                                }
                            >
                                <View style={styles.playTriangle} />
                            </TouchableOpacity>
                        ) : (
                            <TouchableOpacity
                                style={styles.pauseButton}
                                onPress={() =>
                                    pauseTimer(card.id, setTimerCards)
                                }
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
                            onPress={() => handlePlayPress(card.id)}
                        >
                            <View style={styles.playTriangle} />
                        </TouchableOpacity>
                    )}

                    <TouchableOpacity
                        onPress={() => deleteCard(card.id)}
                        style={styles.stopButton}
                    />

                    <TouchableOpacity style={styles.resetButton}>
                        <Text style={styles.resetButtonText}>R</Text>
                    </TouchableOpacity>
                </View>

                {/* Divider */}
                <View style={styles.divider} />

                {/* Add Button */}
                <TouchableOpacity
                    onPress={() => addTimerCard(card.id)}
                    style={styles.addButton}
                >
                    <Text style={styles.addButtonText}>+</Text>
                </TouchableOpacity>
            </View>
        );
    };
    console.log(globalRecentTimers.length, globalRecentTimers);
    return (
        <SafeAreaView style={styles.container}>
            <ScrollView contentContainerStyle={styles.scrollContent}>
                {timerCards.map((card) => renderTimerCard(card))}
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
        justifyContent: "center",  // 👈 Prevent gaps
        alignItems: "center",  // 👈 Ensure vertical alignment
        padding: 10,
      //  flexWrap: "wrap",  // 👈 Allows more circles if they exceed screen width
    
    overflow: "hidden",
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
        fontSize: 45,
        fontWeight: "bold",
        color: "#0A612E",
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
    bottomControls: {
        width: "100%",
        backgroundColor: COLORS.grey,
        flexDirection: "row",
        justifyContent: "space-around",
        alignItems: "center",
        padding: 10,
    },
    incrementControl: {
        flexDirection: "row",
        alignItems: "center",
    },
    incrementButton: {
        paddingHorizontal: 2,
    },
    incrementButtonText: {
        fontSize: 24,
        color: COLORS.blue,
        fontWeight: "bold",
    },




    circleContainer: {
        flexDirection: "row",   // 👈 Make circles align in a row
        justifyContent: "center",  // 👈 Prevent gaps
        alignItems: "center",  // 👈 Ensure vertical alignment
        gap: 0, // 👈 Ensure no gap (React Native 0.71+)
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
        flexShrink: 1,  // 👈 Prevents overlapping issues
    marginHorizontal: 2, // 👈 Ensure small space for a clean layout
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
        gap: 32,
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

export default CountTimerScreen;
