import React, { useState, useEffect, useRef } from "react";
import {
    View,
    Text,
    TouchableOpacity,
    StyleSheet,
    Dimensions,
    ScrollView,
    Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Circle } from "react-native-svg";
import Svg from "react-native-svg";
import * as Notifications from "expo-notifications";
import { AppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as BackgroundFetch from "expo-background-fetch";
import * as TaskManager from "expo-task-manager";

const BACKGROUND_FETCH_TASK = "background-fetch-task";
const RECENT_TIMERS_STORAGE_KEY = "recent-timers";

// Configure notifications to work properly when screen is locked
Notifications.setNotificationHandler({
    handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
        priority: Notifications.AndroidNotificationPriority.HIGH,
    }),
});

// Create notification channel for Android
const createNotificationChannel = async () => {
    if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('timer-channel', {
            name: 'Timer Notifications',
            importance: Notifications.AndroidImportance.HIGH,
            vibrationPattern: [0, 250, 250, 250],
            lightColor: '#FF231F7C',
            lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
            bypassDnd: true,
            sound: true,
        });
    }
};

// Configure notifications for iOS to only show DISMISS action
const configureIOSNotifications = async () => {
    if (Platform.OS === 'ios') {
        await Notifications.setNotificationCategoryAsync('timer', [
            {
                identifier: 'dismiss',
                buttonTitle: 'Dismiss',
                options: {
                    isDestructive: false,
                },
            },
        ]);
    }
};

// Format timer display to avoid decimals
const formatTimerDisplay = (secondsLeft) => {
    // For hours display
    if (secondsLeft >= 3600) {
        return {
            primaryDisplay: Math.floor(secondsLeft / 3600),
            primaryUnit: 'hr',
            secondaryDisplay: null
        };
    }
    // For minutes display
    else if (secondsLeft >= 60) {
        return {
            primaryDisplay: Math.floor(secondsLeft / 60),
            primaryUnit: 'min',
            secondaryDisplay: null
        };
    }
    // For seconds display (no decimals)
    else {
        return {
            primaryDisplay: Math.floor(secondsLeft),
            primaryUnit: 'sec',
            secondaryDisplay: null
        };
    }
};

// Schedule a notification with progress bar
const scheduleTimerNotification = async (cardId, title, body, secondsLeft, originalSeconds) => {
    // Calculate progress percentage for the notification
    const progress = Math.min(100, Math.max(0, Math.round(secondsLeft / originalSeconds * 100)));
    
    // Create a notification that will be visible on lock screen
    await Notifications.scheduleNotificationAsync({
        content: {
            title,
            body,
            data: { cardId, progress, originalSeconds },
            sticky: true,
            autoDismiss: false,
            priority: 'high',
            categoryIdentifier: 'timer',
            ...(Platform.OS === 'android' && {
                android: {
                    channelId: 'timer-channel',
                    actions: [{ title: 'Dismiss', identifier: 'dismiss' }],
                    progress: { 
                        max: 100, 
                        current: progress,
                        indeterminate: false
                    },
                },
            }),
        },
        trigger: null, // Show immediately
    });
};

// Cancel a timer notification
const cancelTimerNotification = async (cardId) => {
    const notifications = await Notifications.getAllScheduledNotificationsAsync();
    for (const notification of notifications) {
        if (notification.content.data?.cardId === cardId) {
            await Notifications.cancelScheduledNotificationAsync(notification.identifier);
        }
    }
};

// Handle notification response (when user interacts with notification)
const handleNotificationResponse = async (response) => {
    const { notification } = response;
    const data = notification.request.content.data;
    
    if (data?.isComplete) {
        // User dismissed a completed timer notification
        await cancelTimerNotification(data.cardId);
    }
};

// Define background task for timer updates
TaskManager.defineTask(BACKGROUND_FETCH_TASK, async () => {
    try {
        const now = Date.now();
        const keys = await AsyncStorage.getAllKeys();
        const timerKeys = keys.filter((key) => key.startsWith("timer-"));
        const timerData = await AsyncStorage.multiGet(timerKeys);
        
        let updatedAny = false;
        let completedTimers = [];
        
        for (const [key, value] of timerData) {
            if (!value) continue;
            
            const timer = JSON.parse(value);
            const cardId = parseInt(key.split("-")[1]);
            
            if (!timer.isPaused) {
                const secondsLeft = Math.max(0, Math.floor((timer.endTime - now) / 1000));
                
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
                    
                    // Update notification with progress
                    const { primaryDisplay, primaryUnit } = formatTimerDisplay(secondsLeft);
                    await scheduleTimerNotification(
                        cardId,
                        "Timer Running",
                        `${primaryDisplay} ${primaryUnit} remaining`,
                        secondsLeft,
                        timer.originalSeconds
                    );
                } else {
                    // Timer completed
                    await AsyncStorage.removeItem(key);
                    completedTimers.push(cardId);
                    updatedAny = true;
                    
                    // Show completion notification that keeps ringing until dismissed
                    await Notifications.scheduleNotificationAsync({
                        content: {
                            title: "Timer Complete!",
                            body: "Your timer is done",
                            sound: true,
                            priority: "high",
                            sticky: true,
                            autoDismiss: false,
                            badge: 1,
                            data: { cardId, isComplete: true },
                            categoryIdentifier: 'timer',
                        },
                        trigger: null, // Show immediately
                    });
                }
            }
        }
        
        // If any timer completed, check if there's a next timer to activate
        if (completedTimers.length > 0) {
            await activateNextTimer(completedTimers);
        }
        
        return updatedAny ? 1 : 0;
    } catch (error) {
        console.error("[Background Fetch] Error:", error);
        return -1;
    }
});

// Function to activate the next timer when one completes
const activateNextTimer = async (completedTimerIds) => {
    try {
        const keys = await AsyncStorage.getAllKeys();
        const timerKeys = keys.filter((key) => key.startsWith("timer-"));
        
        if (timerKeys.length === 0) return;
        
        // Sort timer keys by ID to find the next one
        const sortedTimerKeys = timerKeys.sort((a, b) => {
            const idA = parseInt(a.split("-")[1]);
            const idB = parseInt(b.split("-")[1]);
            return idA - idB;
        });
        
        // Find the first timer after the completed ones
        for (const completedId of completedTimerIds) {
            const nextTimerKey = sortedTimerKeys.find(key => {
                const id = parseInt(key.split("-")[1]);
                return id > completedId;
            });
            
            if (nextTimerKey) {
                const timerData = await AsyncStorage.getItem(nextTimerKey);
                if (timerData) {
                    const timer = JSON.parse(timerData);
                    // Activate this timer if it's paused
                    if (timer.isPaused) {
                        await AsyncStorage.setItem(
                            nextTimerKey,
                            JSON.stringify({
                                ...timer,
                                isPaused: false,
                                startTime: Date.now(),
                                endTime: Date.now() + timer.secondsLeft * 1000,
                            })
                        );
                        
                        // Notify about the next timer
                        const cardId = parseInt(nextTimerKey.split("-")[1]);
                        const { primaryDisplay, primaryUnit } = formatTimerDisplay(timer.secondsLeft);
                        await scheduleTimerNotification(
                            cardId,
                            "Next Timer Started",
                            `${primaryDisplay} ${primaryUnit} timer started`,
                            timer.secondsLeft,
                            timer.originalSeconds
                        );
                        
                        break; // Only activate one next timer
                    }
                }
            }
        }
    } catch (error) {
        console.error("Error activating next timer:", error);
    }
};

// Start a timer
const startTimer = async (cardId, minutes, recentTimers, setRecentTimers, timerCards, setTimerCards) => {
    try {
        // Add to recent timers if not already there
        if (!recentTimers.includes(minutes)) {
            const newRecentTimers = [minutes, ...recentTimers.slice(0, 7)];
            setRecentTimers(newRecentTimers);
            await AsyncStorage.setItem(RECENT_TIMERS_STORAGE_KEY, JSON.stringify(newRecentTimers));
        }
        
        const totalSeconds = minutes * 60;
        const now = Date.now();
        const endTime = now + totalSeconds * 1000;
        
        const timerData = {
            minutes,
            startTime: now,
            endTime,
            secondsLeft: totalSeconds,
            isPaused: false,
            lastUpdated: now,
            originalSeconds: totalSeconds, // Store original seconds for progress calculation
        };
        
        // Save timer to AsyncStorage
        await AsyncStorage.setItem(`timer-${cardId}`, JSON.stringify(timerData));
        
        // Update UI
        setTimerCards((prev) =>
            prev.map((card) =>
                card.id === cardId
                    ? { ...card, activeTimer: timerData }
                    : card
            )
        );
        
        // Schedule notification
        const { primaryDisplay, primaryUnit } = formatTimerDisplay(totalSeconds);
        await scheduleTimerNotification(
            cardId,
            "Timer Started",
            `${primaryDisplay} ${primaryUnit} remaining`,
            totalSeconds,
            totalSeconds
        );
        
        // Register background task if not already registered
        const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_FETCH_TASK);
        if (!isRegistered) {
            await BackgroundFetch.registerTaskAsync(BACKGROUND_FETCH_TASK, {
                minimumInterval: 60, // One minute minimum
                stopOnTerminate: false,
                startOnBoot: true,
            });
        }
    } catch (error) {
        console.error("Error starting timer:", error);
    }
};

// Pause a timer
const pauseTimer = async (cardId, setTimerCards) => {
    try {
        const timerKey = `timer-${cardId}`;
        const timerData = await AsyncStorage.getItem(timerKey);
        
        if (timerData) {
            const timer = JSON.parse(timerData);
            const now = Date.now();
            const secondsLeft = Math.max(0, Math.floor((timer.endTime - now) / 1000));
            
            const updatedTimer = {
                ...timer,
                isPaused: true,
                secondsLeft,
                lastUpdated: now,
            };
            
            await AsyncStorage.setItem(timerKey, JSON.stringify(updatedTimer));
            
            setTimerCards((prev) =>
                prev.map((card) =>
                    card.id === cardId
                        ? { ...card, activeTimer: updatedTimer }
                        : card
                )
            );
            
            // Cancel notification
            await cancelTimerNotification(cardId);
        }
    } catch (error) {
        console.error("Error pausing timer:", error);
    }
};

// Resume a timer
const resumeTimer = async (cardId, setTimerCards) => {
    try {
        const timerKey = `timer-${cardId}`;
        const timerData = await AsyncStorage.getItem(timerKey);
        
        if (timerData) {
            const timer = JSON.parse(timerData);
            const now = Date.now();
            const endTime = now + timer.secondsLeft * 1000;
            
            const updatedTimer = {
                ...timer,
                isPaused: false,
                startTime: now,
                endTime,
                lastUpdated: now,
            };
            
            await AsyncStorage.setItem(timerKey, JSON.stringify(updatedTimer));
            
            setTimerCards((prev) =>
                prev.map((card) =>
                    card.id === cardId
                        ? { ...card, activeTimer: updatedTimer }
                        : card
                )
            );
            
            // Schedule notification
            const { primaryDisplay, primaryUnit } = formatTimerDisplay(timer.secondsLeft);
            await scheduleTimerNotification(
                cardId,
                "Timer Resumed",
                `${primaryDisplay} ${primaryUnit} remaining`,
                timer.secondsLeft,
                timer.originalSeconds
            );
        }
    } catch (error) {
        console.error("Error resuming timer:", error);
    }
};

// Handle timer completion
const onTimerComplete = async (cardId, timerCards) => {
    try {
        // Remove timer from storage
        await AsyncStorage.removeItem(`timer-${cardId}`);
        
        // Show completion notification
        await Notifications.scheduleNotificationAsync({
            content: {
                title: "Timer Complete!",
                body: "Your timer is done",
                sound: true,
                priority: "high",
                sticky: true,
                autoDismiss: false,
                badge: 1,
                data: { cardId, isComplete: true },
                categoryIdentifier: 'timer',
            },
            trigger: null, // Show immediately
        });
        
        // Find the next timer to activate
        const nextCard = timerCards.find(card => 
            card.id > cardId && card.activeTimer && card.activeTimer.isPaused
        );
        
        if (nextCard) {
            await resumeTimer(nextCard.id, () => {});
        }
    } catch (error) {
        console.error("Error handling timer completion:", error);
    }
};

// Restore timers from AsyncStorage
const restoreTimers = async (setTimerCards) => {
    try {
        const keys = await AsyncStorage.getAllKeys();
        const timerKeys = keys.filter((key) => key.startsWith("timer-"));
        
        if (timerKeys.length === 0) return;
        
        const timerData = await AsyncStorage.multiGet(timerKeys);
        const now = Date.now();
        
        setTimerCards((prev) => {
            const updatedCards = [...prev];
            
            for (const [key, value] of timerData) {
                if (!value) continue;
                
                const timer = JSON.parse(value);
                const cardId = parseInt(key.split("-")[1]);
                
                // Find or create card
                let card = updatedCards.find((c) => c.id === cardId);
                
                if (!card) {
                    card = {
                        id: cardId,
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
                    updatedCards.push(card);
                }
                
                // Update timer state
                if (!timer.isPaused) {
                    const secondsLeft = Math.max(0, Math.floor((timer.endTime - now) / 1000));
                    
                    if (secondsLeft > 0) {
                        card.activeTimer = {
                            ...timer,
                            secondsLeft,
                        };
                    } else {
                        // Timer completed while app was closed
                        AsyncStorage.removeItem(key);
                        card.activeTimer = null;
                    }
                } else {
                    card.activeTimer = timer;
                }
            }
            
            return updatedCards;
        });
    } catch (error) {
        console.error("Error restoring timers:", error);
    }
};

const SCREEN_WIDTH = Dimensions.get("window").width;
const CIRCLE_SIZE = 34;
const BORDER_WIDTH = 2;
const COLORS = {
    blue: "#4388CC",
    yellow: "#FFCC33",
    grey: "#F0F0F0",
};

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
        // Initialize notifications
        createNotificationChannel();
        configureIOSNotifications();

        // Set up notification listeners
        const notificationListener =
            Notifications.addNotificationReceivedListener((notification) => {
                console.log("Notification received:", notification);
            });
        const responseListener =
            Notifications.addNotificationResponseReceivedListener(handleNotificationResponse);

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
    };

    // Timer countdown effect
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
                                    return {
                                        ...c,
                                        activeTimer: null,
                                    };
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
                        (card.activeTimer.originalSeconds || card.activeTimer.minutes * 60));

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
                                            `${Math.floor(
                                                card.activeTimer.secondsLeft %
                                                60
                                            )} sec`}
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
                                                            .originalSeconds || 
                                                            card.activeTimer
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
                                            {formatTimerDisplay(card.activeTimer.secondsLeft).primaryDisplay}
                                        </Text>
                                    </View>
                                    <Text style={styles.selectedDurationUnit}>
                                        {formatTimerDisplay(card.activeTimer.secondsLeft).primaryUnit}
                                    </Text>
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

                    <TouchableOpacity 
                        style={styles.resetButton}
                        onPress={() => {
                            deleteCard(card.id);
                            setTimerCards(prev => 
                                prev.map(c => 
                                    c.id === card.id ? {
                                        ...c,
                                        selectedHours: 0,
                                        selectedMinutes: 0,
                                        selectedSeconds: 0,
                                        activeTimer: null
                                    } : c
                                )
                            );
                        }}
                    >
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
        justifyContent: "center",
        alignItems: "center",
        padding: 10,
        overflow: "hidden",
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
        top: "25%",
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
        marginBottom: 15,
    },
    linearProgress: {
        width: 175,
        height: 10,
        borderRadius: 5,
        backgroundColor: "#FFCC33",
        overflow: "hidden",
        flexDirection: "row",
        position: "absolute",
        top: "48%",
    },
    centerDisplay: {
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
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
        marginTop: 100,
    },
    selectedDurationText: {
        fontSize: 45,
        fontWeight: "bold",
        color: "#0A612E",
    },
    selectedDurationUnit: {
        fontSize: 18,
        fontWeight: "bold",
        color: "#0A612E",
        marginTop: 5,
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
    timerButton: {
        width: CIRCLE_SIZE,
        height: CIRCLE_SIZE,
        borderRadius: CIRCLE_SIZE / 2,
        backgroundColor: COLORS.yellow,
        borderWidth: BORDER_WIDTH,
        borderColor: COLORS.blue,
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 1,
        marginHorizontal: 2,
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
});

export default CountTimerScreen;