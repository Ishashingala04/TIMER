import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  ScrollView,
  FlatList,
  Switch,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Notifications from "expo-notifications";
import { AppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as BackgroundFetch from "expo-background-fetch";
import * as TaskManager from "expo-task-manager";
import PagerView from "react-native-pager-view";
import {
  cancelTimerNotification,
  configureNotifications,
  handleNotification,
  handleNotificationResponse,
} from "./services/notification";
import { onTimerComplete } from "./services/timer";
import { Audio } from "expo-av";
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
              body: `${Math.ceil(secondsLeft / 60)} minutes remaining`,
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

const TIMER_COMPLETE_SOUND = require("../assets/alarm.mp3");

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
      <TouchableOpacity onPress={handleIncrement} style={styles.arrowButton}>
        <Text style={styles.arrowText}>▲</Text>
      </TouchableOpacity>

      {/* Number Display */}
      <View style={styles.numberDisplay}>
        <Text style={styles.numberText}>
          {value.toString().padStart(2, "0")}
        </Text>
      </View>

      {/* Down Arrow Button */}
      <TouchableOpacity onPress={handleDecrement} style={styles.arrowButton}>
        <Text style={styles.arrowText}>▼</Text>
      </TouchableOpacity>
    </View>
  );
};

const AlarmScreen = () => {
  // Add this at the top of TimerApp component
  const appState = useRef(AppState.currentState);
  const pager = useRef(null);
  const [globalRecentTimers, setGlobalRecentTimers] = useState([
    15, 30, 5, 10, 1,
  ]);
  const days = ["M", "T", "W", "T", "F", "S", "S"];
  const alarmSoundRef = useRef(null);
  const [currentPage, setCurrentPage] = useState(0);
  const [timerCards, setTimerCards] = useState([
    {
      id: 1,
      selectedHours: 0,
      selectedMinutes: 0,
      selectedSeconds: 0,
      days: [0, 0, 0, 0, 0, 0, 0],
      alarms: [],
      halfDays: 0,
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
  const [firedAlarms, setFiredAlarms] = useState(new Set());
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
    pager.current && pager.current.setPageWithoutAnimation(currentPage);
  }, [currentPage]);

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
          await BackgroundFetch.unregisterTaskAsync(BACKGROUND_FETCH_TASK);
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
    const subscription = AppState.addEventListener(
      "change",
      async (nextAppState) => {
        if (
          appState.current.match(/inactive|background/) &&
          nextAppState === "active"
        ) {
          // App has come to foreground - restore all timer states
          const keys = await AsyncStorage.getAllKeys();
          const timerKeys = keys.filter((key) => key.startsWith("timer-"));
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

  // Add new timer card
  const addTimerCard = (afterId) => {
    setTimerCards((prev) => {
      const index = prev.findIndex((card) => card.id === afterId);
      const newCard = {
        id: Math.max(...prev.map((c) => c.id)) + 1,
        selectedHours: 0,
        selectedMinutes: 0,
        selectedSeconds: 0,
        days: [0, 0, 0, 0, 0, 0, 0],
        alarms: [],
        halfDays: 0,
        activeTimer: null,
        incrementedValues: {
          1: 1,
          5: 5,
          10: 10,
          15: 15,
          30: 30,
        },
      };

      return [...prev.slice(0, index + 1), newCard, ...prev.slice(index + 1)];
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
        setCurrentPage(0);
        // If there is only one card, reset its values and stop the timer
        return [
          {
            id: prev[0].id,
            selectedHours: 0,
            selectedMinutes: 0,
            selectedSeconds: 0,
            activeTimer: null,
            days: [0, 0, 0, 0, 0, 0, 0],
            halfDays: 0,
            alarms: [],
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
        const newPageIndex = currentPage != 0 ? currentPage - 1 : 1;

        setCurrentPage(newPageIndex);
        // If there are multiple cards, stop the timer and delete the card
        return prev.filter((card) => card.id !== cardId);
      }
    });

    // Clean up any running intervals or background tasks for this timer
  };

  useEffect(() => {
    return () => {
      if (alarmSoundRef.current) {
        alarmSoundRef.current.unloadAsync();
      }
    };
  }, []);

  useEffect(() => {
    const intervals = timerCards.map((card) => {
      return setInterval(() => {
        setTimerCards((prev) =>
          prev.map((c) => {
            if (c.id === card.id && c.activeTimer) {
              const newSecondsLeft = c.activeTimer.secondsLeft - 1;
              if (newSecondsLeft <= 0) {
                onTimerComplete(card.id, timerCards); // Timer completed
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
        checkAlarm();
      }, 1000);
    });

    return () =>
      intervals.forEach((interval) => interval && clearInterval(interval));
  }, [timerCards]);

  const checkAlarm = () => {
    const now = new Date();
    const formattedMinutes = now.getMinutes().toString().padStart(2, "0");
    const currentTime = `${now.getHours() % 12 || 12}:${formattedMinutes} ${
      now.getHours() >= 12 ? "PM" : "AM"
    }`;
    const dayOfWeek = now.getDay();
    timerCards.forEach((card) => {
      card.alarms.forEach((alarm) => {
        console.log(alarm.time, currentTime);
        const alarmKey = `${card.id}-${alarm.id}`;
        if (
          alarm.enabled &&
          alarm.time === currentTime &&
          alarm.days[dayOfWeek == 0 ? 6 : dayOfWeek - 1] === 1 &&
          !firedAlarms.has(alarmKey) // Ensure the alarm isn't already triggered
        ) {
          console.log("Alarm time!", alarmKey);
          setFiredAlarms((prev) => new Set(prev).add(alarmKey));
          triggerAlarmNotification(card.id, alarm.id);
          onTimerComplete(card.id, timerCards);
        }
      });
    });
  };

  const playAlarmSound = async () => {
    console.log("Alarm Sound actived!");
    try {
      if (!TIMER_COMPLETE_SOUND) {
        console.error("Sound file is not defined");
        return;
      }

      // Unload previous sound if exists
      if (alarmSoundRef.current) {
        await alarmSoundRef.current.unloadAsync();
      }

      const { sound } = await Audio.Sound.createAsync(TIMER_COMPLETE_SOUND, {
        shouldPlay: true,
        volume: 1.0,
      });

      alarmSoundRef.current = sound;

      // Play the sound
      await sound.playAsync();
    } catch (error) {
      console.error("Failed to play sound", error);
    }
  };

  const triggerAlarmNotification = async (cardId, alarmId) => {
    console.log(`Alarm triggered for card ${cardId}, alarm ${alarmId}`);
    playAlarmSound();
    // Show completion notification
    await Notifications.scheduleNotificationAsync({
      content: {
        title: "Alarm Done!",
        body: `Alarm is done`,
        sound: true,
        priority: "high",
        badge: 1,
      },
      trigger: null, // Show immediately
    });
  };

  const toggleSwitch = (cardId, alarmId) => {
    setTimerCards((prev) =>
      prev.map((card) =>
        card.id === cardId
          ? {
              ...card,
              alarms: card.alarms.map((alarm) =>
                alarm.id === alarmId
                  ? { ...alarm, enabled: !alarm.enabled }
                  : alarm
              ),
            }
          : card
      )
    );
  };
  const addAlarm = (id) => {
    console.log(timerCards[id - 1]);
    setTimerCards((prev) =>
      prev.map((card) =>
        card.id === id
          ? {
              ...card,
              selectedHours: 0,
              selectedMinutes: 0,
              selectedSeconds: 0,
              halfDays: 0,
              days: [0, 0, 0, 0, 0, 0, 0],
              alarms: [
                ...card.alarms,
                {
                  id: (card.alarms.length + 1).toString(),
                  time: `${card.selectedHours}:${card.selectedMinutes
                    .toString()
                    .padStart(2, "0")} ${card.halfDays === 0 ? "AM" : "PM"}`,
                  createdAt: Date.now(),
                  enabled: true,
                  days: [...card.days],
                },
              ],
            }
          : card
      )
    );
  };
  const renderTimerCard = (card) => {
    return (
      <View key={card.id} style={styles.timerCard}>
        {/* Main Alarm */}
        <FlatList
          data={card.alarms}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <View style={styles.alarmItem}>
              <Switch
                value={item.enabled}
                onValueChange={() => toggleSwitch(card.id, item.id)}
              />
              <Text style={styles.text}>ALARM-{item.id}</Text>
              <Text style={styles.time}>{item.time}</Text>
              <View style={styles.alarmDays}>
                {days.map((day, index) => (
                  <View
                    key={index}
                    style={
                      item.days[index] === 0
                        ? styles.alarmPassiveDay
                        : styles.alarmActiveDay
                    }
                  >
                    <Text>{day}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}
        />
        {/* Main Timer Circle */}
        <View style={styles.timerCircle}>
          <View style={styles.centerDisplay}>
            <View style={{ flexDirection: "row", flex: 1 }}>
              <View style={styles.alarmContaier}>
                <Text style={styles.daysText}>ALL DAYS</Text>
                <View style={styles.days}>
                  {days.map((day, index) => (
                    <>
                      {card.days[index] == 0 ? (
                        <Text
                          onPress={() => {
                            setTimerCards((prev) =>
                              prev.map((c) =>
                                c.id === card.id
                                  ? {
                                      ...c,
                                      days: c.days.map((d, i) =>
                                        i === index ? 1 : d
                                      ),
                                    }
                                  : c
                              )
                            );
                          }}
                          style={styles.passiveDay}
                        >
                          {day}
                        </Text>
                      ) : (
                        <Text
                          onPress={() => {
                            setTimerCards((prev) =>
                              prev.map((c) =>
                                c.id === card.id
                                  ? {
                                      ...c,
                                      days: c.days.map((d, i) =>
                                        i === index ? 0 : d
                                      ),
                                    }
                                  : c
                              )
                            );
                          }}
                          style={styles.activeDay}
                        >
                          {day}
                        </Text>
                      )}
                    </>
                  ))}
                </View>
                <View style={styles.timeSelector}>
                  <View style={styles.selectorRow}>
                    <Text style={styles.selectorLabel}>HR</Text>
                    <Text style={styles.selectorLabel}>MIN</Text>
                    <Text style={styles.selectorLabel}>SEC</Text>
                  </View>
                  <View style={styles.wheelsContainer}>
                    <TimeSelector
                      type="selectedHours"
                      max={12}
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
                  <View style={styles.halfdays}>
                    {card.halfDays == 0 ? (
                      <Text
                        style={styles.activeHalfDay}
                        onPress={() => {
                          setTimerCards((prev) => {
                            return prev.map((c) => {
                              if (c.id === card.id) {
                                return {
                                  ...c,
                                  halfDays: 0,
                                };
                              }
                              return c;
                            });
                          });
                        }}
                      >
                        AM
                      </Text>
                    ) : (
                      <Text
                        style={styles.passiveHalfDay}
                        onPress={() => {
                          setTimerCards((prev) => {
                            return prev.map((c) => {
                              if (c.id === card.id) {
                                return {
                                  ...c,
                                  halfDays: 0,
                                };
                              }
                              return c;
                            });
                          });
                        }}
                      >
                        AM
                      </Text>
                    )}
                    {card.halfDays == 0 ? (
                      <Text
                        style={styles.passiveHalfDay}
                        onPress={() => {
                          setTimerCards((prev) => {
                            return prev.map((c) => {
                              if (c.id === card.id) {
                                return {
                                  ...c,
                                  halfDays: 1,
                                };
                              }
                              return c;
                            });
                          });
                        }}
                      >
                        PM
                      </Text>
                    ) : (
                      <Text
                        style={styles.activeHalfDay}
                        onPress={() => {
                          setTimerCards((prev) => {
                            return prev.map((c) => {
                              if (c.id === card.id) {
                                return {
                                  ...c,
                                  halfDays: 1,
                                };
                              }
                              return c;
                            });
                          });
                        }}
                      >
                        PM
                      </Text>
                    )}
                  </View>
                </View>
                <TouchableOpacity
                  style={styles.startButton}
                  onPress={() => addAlarm(card.id)}
                >
                  <Text
                    style={styles.startButtonText}
                    numberOfLines={1}
                    ellipsizeMode="end"
                  >
                    START
                  </Text>
                </TouchableOpacity>
              </View>
              <View>
                <TouchableOpacity style={styles.deleteButton}>
                  <Text
                    style={styles.deleteButtonText}
                    onPress={() => deleteCard(card.id)}
                  >
                    DELETE
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>

        {/* Active Player Controls */}
        <View style={styles.bottomBar}>
          <View style={styles.bubble} />
          <View style={styles.bubble} />
          <View style={styles.bubble} />
          <View style={styles.bubble} />
        </View>

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
      <View style={styles.container}>
        <PagerView
          ref={pager}
          style={styles.container}
          initialPage={currentPage}
          onPageSelected={(e) => setCurrentPage(e.nativeEvent.position)}
        >
          {timerCards.map((card) => (
            <View style={styles.page} key={card.id}>
              <ScrollView>{renderTimerCard(card)}</ScrollView>
            </View>
          ))}
        </PagerView>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  page: {
    justifyContent: "center",
    alignItems: "center",
  },
  timerCard: {
    alignItems: "center",
    width: SCREEN_WIDTH,
    maxWidth: 400,
    marginBottom: 20,
  },
  circleItem: {
    width: 40,
    height: 40,
    borderRadius: 20,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center",
    backgroundColor: COLORS.yellow,
    borderWidth: 2,
    borderColor: COLORS.blue,
    marginHorizontal: 15,
    marginVertical: 5,
  },
  itemText: {
    color: COLORS.blue,
    fontSize: 18,
    fontWeight: "bold",
  },
  alarmContaier: {
    marginTop: 90,
    width: 250,
    backgroundColor: COLORS.yellow,
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center",
    height: 450,
    borderColor: COLORS.blue,
    borderWidth: 5,
    padding: 10,
    marginLeft: 60,
  },
  daysText: {
    fontSize: 24,
    fontWeight: "bold",
    color: COLORS.blue,
    textAlign: "center",
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center",
  },
  days: {
    display: "flex",
    flexDirection: "row",
    justifyContent: "space-around",
    fontSize: 24,
    gap: 10,
  },
  passiveDay: {
    width: 20,
    height: 20,
    borderRadius: 10,
    color: COLORS.yellow,
    backgroundColor: COLORS.grey,
    textAlign: "center",
  },
  activeDay: {
    width: 20,
    height: 20,
    borderRadius: 10,
    color: COLORS.yellow,
    backgroundColor: COLORS.blue,
    textAlign: "center",
  },
  timeSelector: {
    height: 200,
    width: 200,
    borderRadius: 125,
    marginTop: 30,
    padding: 20,
    borderWidth: 3,
    borderColor: COLORS.blue,
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
    marginTop: -200,
  },
  selectedDurationText: {
    fontSize: 24,
    fontWeight: "bold",
    color: COLORS.blue,
  },
  selectorRow: {
    flexDirection: "row",
    justifyContent: "space-around",
    marginBottom: 8,
    marginTop: 20,
  },
  selectorLabel: {
    color: COLORS.blue,
    fontWeight: "bold",
    textAlign: "center",
    fontSize: 24,
  },
  wheelsContainer: {
    flexDirection: "row",
    justifyContent: "space-around",
  },
  halfdays: {
    flexDirection: "row",
    justifyContent: "space-around",
    height: 30,
    width: 120,
    marginLeft: 18,
    marginTop: 15,
    alignItems: "center",
  },
  activeHalfDay: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: COLORS.blue,
    color: COLORS.yellow,
    textAlign: "center",
    paddingTop: 5,
  },
  passiveHalfDay: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: COLORS.grey,
    color: COLORS.yellow,
    textAlign: "center",
    paddingTop: 5,
  },
  startButton: {
    marginTop: 30,
    width: 80,
    height: 35,
    borderRadius: "50%",
    borderWidth: 3,
    borderColor: COLORS.blue,
    alignItems: "center",
  },
  startButtonText: {
    fontSize: 18,
    color: COLORS.blue,
    fontWeight: "bold",
    marginTop: 2,
  },
  deleteButton: {
    height: 48,
    width: 48,
    borderRadius: 24,
    backgroundColor: COLORS.yellow,
    marginTop: 120,
    marginLeft: 10,
    borderWidth: 3,
    borderColor: "red",
    justifyContent: "center",
    alignItems: "center",
  },
  deleteButtonText: {
    color: "red",
    fontSize: 11,
    fontWeight: "bold",
  },
  timerCircle: {
    width: 300,
    height: 300,
    marginVertical: 20,
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
  centerDisplay: {
    alignItems: "center",
    justifyContent: "center",
  },
  activePlayerControls: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 32,
    marginTop: 20,
  },
  playerControls: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 32,
    marginTop: -120,
  },
  resumeButton: {
    width: 48,
    height: 48,
    backgroundColor: "#22C55E",
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
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
    marginTop: 30,
  },
  addButtonContainer: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 10,
  },
  bottomBar: {
    marginTop: 260,
    display: "flex",
    flexDirection: "row",
    gap: 10,
  },
  bubble: {
    height: 12,
    width: 12,
    borderRadius: 6,
    backgroundColor: "#DDDDDD",
    marginBottom: 20,
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
    height: CIRCLE_SIZE * 1.5,
    backgroundColor: "white",
    borderWidth: BORDER_WIDTH,
    borderColor: COLORS.blue,
    borderRadius: 4,
    overflow: "hidden",
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
  alarmItem: {
    flexDirection: "row",
    alignItems: "center",
    padding: 10,
  },
  text: {
    color: "blue",
    fontSize: 16,
    fontWeight: "bold",
    marginLeft: 10,
  },
  time: {
    color: "blue",
    fontSize: 16,
    fontWeight: "bold",
    marginLeft: 15,
  },
  countdown: {
    color: "blue",
    fontSize: 14,
    marginLeft: 15,
  },
  alarmDays: {
    display: "flex",
    flexDirection: "row",
    paddingLeft: 10,
    gap: 3,
  },
  alarmPassiveDay: {
    height: 20,
    width: 20,
    borderRadius: 10,
    backgroundColor: COLORS.blue,
    color: COLORS.grey,
    alignItems: "center",
    justifyContent: "center",
  },
  alarmActiveDay: {
    height: 20,
    width: 20,
    borderRadius: 10,
    backgroundColor: COLORS.yellow,
    color: COLORS.grey,
    alignItems: "center",
    justifyContent: "center",
  },
});

export default AlarmScreen;
