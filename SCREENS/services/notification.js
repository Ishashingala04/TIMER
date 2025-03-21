import * as Notifications from "expo-notifications";

export const handleNotification = (notification) => {
    console.log("Notification received:", notification);
};

// Handle notification response
export const handleNotificationResponse = async (response) => {
    const { actionIdentifier, notification } = response;
    const { timerId } = notification.request.content.data;

    switch (actionIdentifier) {
        case "dismiss":
            await cancelTimerNotification(timerId);
            break;
        case "snooze":
            // Add 5 minutes to timer
            await scheduleCompletionNotification(timerId, 5);
            break;
        default:
            // Open app
            break;
    }
};

// Schedule completion notification
export const scheduleCompletionNotification = async (timerId, minutes) => {
    await Notifications.scheduleNotificationAsync({
        content: {
            title: "Timer Complete!",
            body: `Your ${minutes} minute timer is done`,
            sound: "timer_complete.wav",
            priority: "max",
            sticky: true, // Keep notification until dismissed
            autoDismiss: false,
            categoryIdentifier: "timer",
            data: { timerId },
        },
        trigger: {
            seconds: minutes * 60,
        },
    });
};

// Notification configuration
export const configureNotifications = () => {
    Notifications.setNotificationHandler({
        handleNotification: async () => ({
            shouldShowAlert: true,
            shouldPlaySound: true,
            shouldSetBadge: true,
            sound: "timer_complete.wav", // Custom sound file
        }),
    });

    // Configure notification categories/actions
    Notifications.setNotificationCategoryAsync("timer", [
        {
            identifier: "dismiss",
            buttonTitle: "Dismiss",
            options: {
                isDestructive: false,
            },
        },
        {
            identifier: "snooze",
            buttonTitle: "Snooze 5m",
            options: {
                isDestructive: false,
            },
        },
    ]);
};

// Function to cancel notification
export const cancelTimerNotification = async (timerId) => {
    try {
        await Notifications.cancelScheduledNotificationAsync(
            timerId.toString()
        );
        await Notifications.dismissNotificationAsync(timerId.toString());
    } catch (error) {
        console.error("Error cancelling notification:", error);
    }
};
