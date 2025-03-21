// // // //TO DO A
// // // // WORLD CLOCK SEARCHABLE BY CITY OR COUNTRY AS IN FIGMA SHOWN

// // // // COUNTDOWN TIMER "ONE CLICK" AS IN THE 2 FRAMES SHOWN
// // // // COUNTDOWN TIMER AND COUNTDOWN TIMER SHAPE 2

// // // // ALARM AS SHOWN IN FIGMA

// // // // STOP WATCH WITH A SOUND

// // // // THE APP ALSO NEEDS A WAY TO ADJUST RINGTONE FOR EACH OF THE ABOVE 4 AND SNOOZE OR DELETE OR DISMISS

// // // // THE TIMER AND ALAARM A STOPWATCH ARE SHOWNI N THE "NOTIFICATION " SCREEN

// // // // I DID NOT DRAW THE NOTIFICATION AND THE SETTINGS OF THE RINGTONE SO PLEASE DO IT AS YOU THINK IS GOOD

// export default App;
import React from "react";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { NavigationContainer } from "@react-navigation/native";
import { FontAwesome, Ionicons } from "@expo/vector-icons";
import CountTimerScreen from "./SCREENS/CountTimerScreen";
import WorldClockScreen from "./SCREENS/WorldClockScreen";
import CountTimer2Screen from "./SCREENS/CountTimer2Screen";
import AlarmScreen from "./SCREENS/AlarmScreen";
import StopWatchScreen from "./SCREENS/StopWatch";

const Tab = createBottomTabNavigator();

const App = () => {
    return (
        <NavigationContainer>
            <Tab.Navigator
                screenOptions={{
                    tabBarStyle: {
                        backgroundColor: "#f8f8f8",
                        borderTopColor: "transparent",
                    },
                    tabBarActiveTintColor: "#007AFF",
                    tabBarInactiveTintColor: "#A9A9A9",
                }}
            >
                <Tab.Screen
                    name="World Clock"
                    component={WorldClockScreen}
                    options={{
                        tabBarLabel: "World Clock",
                        tabBarIcon: ({ color, size }) => (
                            <Ionicons name="globe" size={size} color={color} />
                        ),
                    }}
                />
                <Tab.Screen
                    name="Count Timer"
                    component={CountTimerScreen}
                    options={{
                        tabBarLabel: "Count Timer",
                        tabBarIcon: ({ color, size }) => (
                            <Ionicons name="timer" size={size} color={color} />
                        ),
                    }}
                />
                <Tab.Screen
                    name="Count Timer2"
                    component={CountTimer2Screen}
                    options={{
                        tabBarLabel: "Count Timer2",
                        tabBarIcon: ({ color, size }) => (
                            <Ionicons
                                name="hourglass-outline"
                                size={size}
                                color={color}
                            />
                        ),
                    }}
                />
                <Tab.Screen
                    name="Alarm"
                    component={AlarmScreen}
                    options={{
                        tabBarLabel: "Alarm",
                        tabBarIcon: ({ color, size }) => (
                            <Ionicons name="alarm" size={size} color={color} />
                        ),
                    }}
                />
                <Tab.Screen
                    name="Stop Watch"
                    component={StopWatchScreen}
                    options={{
                        tabBarLabel: "Stop Watch",
                        tabBarIcon: ({ color, size }) => (
                            <Ionicons
                                name="stopwatch"
                                size={size}
                                color={color}
                            />
                        ),
                    }}
                />
            </Tab.Navigator>
        </NavigationContainer>
    );
};

export default App;
