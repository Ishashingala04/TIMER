import AsyncStorage from "@react-native-async-storage/async-storage";
import {
    cancelTimerNotification,
    scheduleCompletionNotification,
} from "./notification";
import { Audio } from "expo-av";

const RECENT_TIMERS_STORAGE_KEY = "recent-timers";
const TIMER_COMPLETE_SOUND = require("../../assets/alarm.mp3");

// Timer Functions
export const startTimer = async (
    cardId,
    minutes,
    globalRecentTimers,
    setGlobalRecentTimers,
    timerCards,
    setTimerCards
) => {
    console.log("called");
    const now = Date.now();
    const endTime = now + minutes * 60 * 1000;

    // Update recent timers list
    setGlobalRecentTimers((prev) =>
        [minutes, ...prev.filter((t) => t !== minutes)].slice(0, 10)
    );

    const updatedTimers = [
        minutes,
        ...globalRecentTimers.filter((t) => t !== minutes),
    ].slice(0, 10);

    setGlobalRecentTimers(updatedTimers);

    try {
        await AsyncStorage.setItem(
            RECENT_TIMERS_STORAGE_KEY,
            JSON.stringify(updatedTimers)
        );
    } catch (error) {
        console.error("Error saving recent timers:", error);
    }
    // Save to AsyncStorage
    try {
        await AsyncStorage.setItem(
            `timer-${cardId}`,
            JSON.stringify({
                minutes,
                endTime,
                isPaused: false,
                secondsLeft: minutes * 60,
            })
        );
    } catch (error) {
        console.error("Error saving timer:", error);
    }

    // Schedule notification
    try {
        // Cancel any existing notifications for this timer
        await cancelTimerNotification(cardId);

        // Schedule new notification
        await scheduleCompletionNotification(cardId, minutes);
    } catch (error) {
        console.error("Error scheduling notification:", error);
    }

    // Update timer state
    setTimerCards((prev) =>
        prev.map((card) => {
            if (card.id === cardId) {
                return {
                    ...card,
                    activeTimer: {
                        minutes,
                        secondsLeft: minutes * 60,
                        endTime,
                        isPaused: false,
                    },
                };
            }
            return card;
        })
    );

    // Play start sound (optional)
    try {
        const { sound } = await Audio.Sound.createAsync(TIMER_COMPLETE_SOUND);
        await sound.setVolumeAsync(0.5); // Lower volume for start sound
        await sound.playAsync();
        // Unload sound after playing
        sound.unloadAsync();
    } catch (error) {
        console.error("Error playing start sound:", error);
    }
};

// Stop timer
const stopTimer = async (cardId, setTimerCards) => {
    // Cancel any existing notifications
    await cancelTimerNotification(cardId);

    setTimerCards((prev) =>
        prev.map((card) => {
            if (card.id === cardId && card.activeTimer) {
                return {
                    ...card,
                    activeTimer: null,
                };
            }
            return card;
        })
    );
};

// Pause timer
// Pause timer needs to update AsyncStorage
export const pauseTimer = async (cardId, setTimerCards) => {
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
            if (card.id === cardId && card.activeTimer) {
                return {
                    ...card,
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

// Resume timer
export const resumeTimer = (cardId, setTimerCards) => {
    setTimerCards((prev) =>
        prev.map((card) => {
            if (card.id === cardId && card.activeTimer) {
                return {
                    ...card,
                    activeTimer: {
                        ...card.activeTimer,
                        isPaused: false,
                    },
                };
            }
            return card;
        })
    );
};

export const restoreTimers = async (setTimerCards) => {
    try {
        const keys = await AsyncStorage.getAllKeys();
        const timerKeys = keys.filter((key) => key.startsWith("timer-"));
        const timerData = await AsyncStorage.multiGet(timerKeys);

        const restoredTimers = timerData
            .map(([key, value]) => {
                if (!value) return null;
                const data = JSON.parse(value);
                const cardId = parseInt(key.split("-")[1]);
                const now = Date.now();
                const secondsLeft = Math.max(
                    0,
                    Math.floor((data.endTime - now) / 1000)
                );

                return {
                    cardId,
                    minutes: data.minutes,
                    secondsLeft,
                    isPaused: data.isPaused,
                };
            })
            .filter(Boolean);

        // Update timer cards with restored data
        setTimerCards((prev) =>
            prev.map((card) => {
                const restoredTimer = restoredTimers.find(
                    (t) => t.cardId === card.id
                );
                if (restoredTimer) {
                    return {
                        ...card,
                        activeTimer: {
                            minutes: restoredTimer.minutes,
                            secondsLeft: restoredTimer.secondsLeft,
                            isPaused: restoredTimer.isPaused,
                        },
                    };
                }
                return card;
            })
        );
    } catch (error) {
        console.error("Error restoring timers:", error);
    }
};

export const onTimerComplete = async (cardId, timerCards) => {
    // Play sound even if app is in foreground
    try {
        const { sound } = await Audio.Sound.createAsync(
            require("../../assets/alarm.mp3")
        );
        await sound.playAsync();
    } catch (error) {
        console.error("Error playing sound:", error);
    }

    // Show completion notification
    await scheduleCompletionNotification(
        cardId,
        timerCards.find((c) => c.id === cardId).activeTimer.minutes
    );
};
