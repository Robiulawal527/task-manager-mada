import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants, { ExecutionEnvironment } from "expo-constants";
import { Ionicons } from "@expo/vector-icons";
import DraggableFlatList, { RenderItemParams } from "react-native-draggable-flatlist";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

type Priority = "Low" | "Medium" | "High" | "Urgent";
type Screen = "dashboard" | "boards" | "board" | "add" | "list" | "notifications";

type Comment = {
  id: string;
  author: string;
  text: string;
  createdAt: string;
};

type ActivityLog = {
  id: string;
  action: string;
  createdAt: string;
};

type Task = {
  id: string;
  title: string;
  description: string;
  assignedTo: string;
  requiredTime: string;
  deadline: string;
  priority: Priority;
  status: string;
  reminderAt: string;
  comments: Comment[];
  logs: ActivityLog[];
  completed: boolean;
  createdAt: string;
  updatedAt: string;
  notificationId?: string;
};

type NewTaskInput = {
  title: string;
  description: string;
  assignedTo: string;
  requiredTime: string;
  deadline: string;
  reminderAt: string;
  priority: Priority;
};

type TaskList = {
  id: string;
  title: string;
  cards: Task[];
};

type Board = {
  id: string;
  title: string;
  createdAt: string;
  lists: TaskList[];
};

type NotificationItem = {
  id: string;
  taskId?: string;
  title: string;
  message: string;
  createdAt: string;
  deliverAt: string;
  read: boolean;
  delivered: boolean;
};

type NotificationsModule = typeof import("expo-notifications");
type DropZone = { x: number; y: number; width: number; height: number };

// অ্যাপের সব বোর্ড, টাস্ক ও নোটিফিকেশন এই key দিয়ে ফোনের লোকাল স্টোরেজে রাখা হয়।
const STORAGE_KEY = "taskflow-mobile-state-v3";

// Expo Go-তে native notification API সীমিত, তাই এখানে আগেই বুঝে নিই fallback লাগবে কিনা।
const isExpoGo =
  Constants.executionEnvironment === ExecutionEnvironment.StoreClient ||
  Constants.appOwnership === "expo";

// নতুন বোর্ড বানালে Trello-এর মতো এই চারটি default column/list তৈরি হয়।
const DEFAULT_LISTS = [
  { id: "todo", title: "To Do" },
  { id: "in-progress", title: "In Progress" },
  { id: "review", title: "Review" },
  { id: "completed", title: "Completed" },
];

// বর্তমান সময় ISO string হিসেবে দেয়, যাতে storage ও sorting consistent থাকে।
const nowIso = () => new Date().toISOString();

// প্রতিটি board/list/task/comment/log-এর জন্য unique id বানায়।
const makeId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

// কোনো task action ঘটলে activity log object বানায়।
const createLog = (action: string): ActivityLog => ({
  id: makeId("log"),
  action,
  createdAt: nowIso(),
});

// default list template থেকে fresh list array বানায়, যাতে প্রতিটি board আলাদা data পায়।
const createDefaultLists = (): TaskList[] =>
  DEFAULT_LISTS.map((list) => ({ ...list, cards: [] }));

// app প্রথমবার open হলে দেখানোর জন্য starter board বানায়।
const createInitialBoards = (): Board[] => [
  {
    id: "board-1",
    title: "TaskFlow Board",
    createdAt: nowIso(),
    lists: createDefaultLists(),
  },
];

// ISO/date string কে user-friendly date/time text বানায়।
const formatDateTime = (value?: string) => {
  if (!value) return "Not set";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
};

// Date object থেকে YYYY-MM-DD input format বানায়।
const toInputDate = (value: Date) => {
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${value.getFullYear()}-${month}-${day}`;
};

// Date object থেকে HH:MM input format বানায়।
const toInputTime = (value: Date) => {
  const hour = String(value.getHours()).padStart(2, "0");
  const minute = String(value.getMinutes()).padStart(2, "0");
  return `${hour}:${minute}`;
};

// date input ও time input মিলিয়ে valid Date object বানায়।
const parseDateTime = (date: string, time: string) => {
  const parsed = new Date(`${date.trim()}T${time.trim()}:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

// deadline থেকে এখন পর্যন্ত কত সময় আছে, সেটাই required time হিসেবে calculate করে।
const calculateRequiredTimeFromDeadline = (deadline: Date | null) => {
  if (!deadline) return "Select a valid deadline";
  const diff = deadline.getTime() - Date.now();
  if (diff <= 0) return "Deadline has passed";
  const totalMinutes = Math.ceil(diff / (1000 * 60));
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  const parts = [
    days > 0 ? `${days}d` : "",
    hours > 0 ? `${hours}h` : "",
    minutes > 0 && days === 0 ? `${minutes}m` : "",
  ].filter(Boolean);
  return `${parts.join(" ") || "Less than 1m"} remaining`;
};

// deadline ও completion দেখে task-এর urgency state বের করে।
const getTaskState = (task: Task) => {
  if (task.completed) return "completed";
  const deadline = new Date(task.deadline).getTime();
  if (Number.isNaN(deadline)) return "normal";
  const diff = deadline - Date.now();
  if (diff <= 0) return "overdue";
  if (diff <= 24 * 60 * 60 * 1000) return "soon";
  if (diff <= 3 * 24 * 60 * 60 * 1000) return "upcoming";
  return "normal";
};

// deadline পর্যন্ত কত সময় বাকি আছে বা কত overdue হয়েছে, সেই label বানায়।
const getRemainingTime = (task: Task) => {
  if (task.completed) return "Completed";
  const deadline = new Date(task.deadline).getTime();
  if (Number.isNaN(deadline)) return "No deadline";
  const diff = deadline - Date.now();
  const abs = Math.abs(diff);
  const days = Math.floor(abs / (24 * 60 * 60 * 1000));
  const hours = Math.ceil((abs % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
  const label = days > 0 ? `${days}d ${hours}h` : `${Math.max(hours, 1)}h`;
  return diff < 0 ? `${label} overdue` : `${label} left`;
};

// priority badge-এর color theme ঠিক করে।
const getPriorityTheme = (priority: Priority) => {
  switch (priority) {
    case "Low":
      return { bg: "#dbeafe", text: "#1d4ed8" };
    case "Medium":
      return { bg: "#fef3c7", text: "#92400e" };
    case "High":
      return { bg: "#ffedd5", text: "#c2410c" };
    case "Urgent":
      return { bg: "#fee2e2", text: "#b91c1c" };
  }
};

// task card-এর background/border color deadline ও completed status অনুযায়ী ঠিক করে।
const getCardTheme = (task: Task) => {
  switch (getTaskState(task)) {
    case "completed":
      return { bg: "#dcfce7", border: "#16a34a", accent: "#15803d" };
    case "overdue":
      return { bg: "#fee2e2", border: "#dc2626", accent: "#b91c1c" };
    case "soon":
      return { bg: "#ffedd5", border: "#f97316", accent: "#c2410c" };
    case "upcoming":
      return { bg: "#fef9c3", border: "#eab308", accent: "#a16207" };
    default:
      return { bg: "#ffffff", border: "#dbe3ef", accent: "#64748b" };
  }
};

// একটি list-এর task গুলোর urgency দেখে পুরো list/column-এর color tint ঠিক করে।
const getListTheme = (list: TaskList) => {
  if (list.cards.length > 0 && list.cards.every((task) => task.completed)) {
    return { bg: "#ecfdf5", border: "#bbf7d0", header: "#166534" };
  }
  if (list.cards.some((task) => getTaskState(task) === "overdue")) {
    return { bg: "#fef2f2", border: "#fecaca", header: "#991b1b" };
  }
  if (list.cards.some((task) => getTaskState(task) === "soon")) {
    return { bg: "#fff7ed", border: "#fed7aa", header: "#9a3412" };
  }
  if (list.cards.some((task) => getTaskState(task) === "upcoming")) {
    return { bg: "#fefce8", border: "#fde68a", header: "#854d0e" };
  }
  return { bg: "#eef2f7", border: "#dbe3ef", header: "#0f172a" };
};

// মূল app component: সব state, storage, notification, board/task action এখান থেকে control হয়।
export default function TaskFlowApp() {
  const [boards, setBoards] = useState<Board[]>(createInitialBoards());
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [activeBoardId, setActiveBoardId] = useState("board-1");
  const [screen, setScreen] = useState<Screen>("dashboard");
  const [newBoardName, setNewBoardName] = useState("");
  const [newListName, setNewListName] = useState("");
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [commentText, setCommentText] = useState("");
  const [commentAuthor, setCommentAuthor] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const notificationsRef = useRef<NotificationsModule | null>(null);

  // বর্তমানে কোন board খোলা আছে, সেটা activeBoardId দিয়ে খুঁজে বের করি।
  const activeBoard = boards.find((board) => board.id === activeBoardId) ?? boards[0];

  // সব board-এর সব task এক জায়গায় flatten করি, dashboard/list view-এর জন্য।
  const allTasks = useMemo(
    () =>
      boards.flatMap((board) =>
        board.lists.flatMap((list) =>
          list.cards.map((task) => ({ ...task, boardId: board.id, boardTitle: board.title, listId: list.id }))
        )
      ),
    [boards]
  );

  // dashboard-এর count/statistics এখানে calculate হয়।
  const dashboardStats = useMemo(() => {
    const completed = allTasks.filter((task) => task.completed).length;
    const overdue = allTasks.filter((task) => getTaskState(task) === "overdue").length;
    return {
      boards: boards.length,
      tasks: allTasks.length,
      completed,
      overdue,
      unread: notifications.filter((item) => !item.read).length,
    };
  }, [allTasks, boards.length, notifications]);

  // boards ও notifications AsyncStorage-এ save করে, যাতে app restart করলেও data থাকে।
  const persistState = useCallback(async (nextBoards: Board[], nextNotifications: NotificationItem[]) => {
    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ boards: nextBoards, notifications: nextNotifications, activeBoardId })
    );
  }, [activeBoardId]);

  // app load হওয়ার সময় AsyncStorage থেকে আগের saved data read করে state-এ বসায়।
  useEffect(() => {
    const loadState = async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as {
            boards?: Board[];
            notifications?: NotificationItem[];
            activeBoardId?: string;
          };
          if (parsed.boards?.length) {
            setBoards(
              parsed.boards.map((board) =>
                board.title === "University Assignment Planner"
                  ? { ...board, title: "TaskFlow Board" }
                  : board
              )
            );
            setActiveBoardId(parsed.activeBoardId ?? parsed.boards[0].id);
          }
          if (parsed.notifications) setNotifications(parsed.notifications);
        }
      } catch {
        Alert.alert("Storage issue", "Saved data could not be loaded, so TaskFlow started with a fresh board.");
      } finally {
        setHydrated(true);
      }
    };

    loadState();
  }, []);

  // boards বা notifications বদলালেই latest data local storage-এ save হয়।
  useEffect(() => {
    if (hydrated) persistState(boards, notifications);
  }, [boards, notifications, hydrated, persistState]);

  // reminder time পার হলে in-app notification delivered হিসেবে mark করে।
  const markDueNotificationsDelivered = useCallback(() => {
    setNotifications((previous) =>
      previous.map((item) => {
        if (item.delivered || new Date(item.deliverAt).getTime() > Date.now()) return item;
        return { ...item, delivered: true, read: false, createdAt: nowIso() };
      })
    );
  }, []);

  // প্রতি ৩০ সেকেন্ডে pending reminder check করে notification center update করে।
  useEffect(() => {
    markDueNotificationsDelivered();
    const timer = setInterval(markDueNotificationsDelivered, 30000);
    return () => clearInterval(timer);
  }, [markDueNotificationsDelivered]);

  // native notification permission/channel setup করে; Expo Go/Web হলে safe fallback দেয়।
  const ensureNotifications = useCallback(async () => {
    if (Platform.OS === "web" || isExpoGo) return null;

    const module = await import("expo-notifications");
    notificationsRef.current = module;
    module.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
      }),
    });

    const current = await module.getPermissionsAsync();
    const finalStatus = current.status === "granted" ? current : await module.requestPermissionsAsync();
    if (finalStatus.status !== "granted" && !finalStatus.granted) {
      Alert.alert("Notifications disabled", "Enable notifications in system settings to receive task reminders.");
      return module;
    }

    if (Platform.OS === "android") {
      await module.setNotificationChannelAsync("task-reminders", {
        name: "Task reminders",
        importance: module.AndroidImportance.MAX,
        sound: "default",
        vibrationPattern: [0, 250, 250, 250],
      });
    }

    return module;
  }, []);

  // device notification আসলে সেটাকে app-এর notification center-এ unread হিসেবে update করে।
  useEffect(() => {
    let subscription: { remove: () => void } | undefined;
    ensureNotifications()
      .then((module) => {
        if (!module) return;
        subscription = module.addNotificationReceivedListener((notification) => {
          const taskId = notification.request.content.data?.taskId as string | undefined;
          setNotifications((previous) =>
            previous.map((item) =>
              item.taskId === taskId
                ? { ...item, delivered: true, read: false, createdAt: nowIso() }
                : item
            )
          );
        });
      })
      .catch(() => undefined);

    return () => subscription?.remove();
  }, [ensureNotifications]);

  // task-এর reminderAt অনুযায়ী local notification schedule করে।
  const scheduleReminder = async (task: Task) => {
    const reminderDate = new Date(task.reminderAt);
    if (Number.isNaN(reminderDate.getTime()) || reminderDate <= new Date()) return undefined;

    const module = await ensureNotifications();
    if (!module) return undefined;

    try {
      return await module.scheduleNotificationAsync({
        content: {
          title: "Task reminder",
          body: `"${task.title}" is due soon.`,
          data: { taskId: task.id },
          sound: "default",
        },
        trigger: {
          type: module.SchedulableTriggerInputTypes.DATE,
          date: reminderDate,
          channelId: "task-reminders",
        },
      });
    } catch {
      Alert.alert("Reminder issue", "The task was saved, but the device notification could not be scheduled.");
      return undefined;
    }
  };

  // notification center-এ একটি reminder notification item যোগ করে।
  const addNotificationForTask = (task: Task, delivered = false) => {
    const item: NotificationItem = {
      id: makeId("notification"),
      taskId: task.id,
      title: "Task reminder",
      message: `"${task.title}" is due soon.`,
      createdAt: nowIso(),
      deliverAt: task.reminderAt,
      read: false,
      delivered,
    };
    setNotifications((previous) => [item, ...previous]);
  };

  // যেকোনো board/list-এর ভিতরে থাকা নির্দিষ্ট task update করার reusable helper।
  const updateTask = (taskId: string, updater: (task: Task) => Task) => {
    setBoards((previous) =>
      previous.map((board) => ({
        ...board,
        lists: board.lists.map((list) => ({
          ...list,
          cards: list.cards.map((task) => (task.id === taskId ? updater(task) : task)),
        })),
      }))
    );
  };

  // user input থেকে নতুন board তৈরি করে active board বানায়।
  const addBoard = () => {
    const title = newBoardName.trim();
    if (!title) {
      Alert.alert("Board name required", "Give the board a short, useful name.");
      return;
    }

    const board: Board = {
      id: makeId("board"),
      title,
      createdAt: nowIso(),
      lists: createDefaultLists(),
    };
    setBoards((previous) => [...previous, board]);
    setActiveBoardId(board.id);
    setNewBoardName("");
    setScreen("board");
  };

  // board delete করার আগে confirmation নেয় এবং কমপক্ষে একটি board রাখে।
  const deleteBoard = (boardId: string) => {
    if (boards.length === 1) {
      Alert.alert("Keep one board", "TaskFlow needs at least one board.");
      return;
    }

    Alert.alert("Delete board?", "This removes its lists, tasks, comments, and logs from this phone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          setBoards((previous) => {
            const next = previous.filter((board) => board.id !== boardId);
            if (boardId === activeBoardId) setActiveBoardId(next[0].id);
            return next;
          });
        },
      },
    ]);
  };

  // active board-এ নতুন custom list/column যোগ করে।
  const addList = () => {
    const title = newListName.trim();
    if (!title || !activeBoard) {
      Alert.alert("List name required", "Name the list before adding it.");
      return;
    }

    setBoards((previous) =>
      previous.map((board) =>
        board.id === activeBoard.id
          ? { ...board, lists: [...board.lists, { id: makeId("list"), title, cards: [] }] }
          : board
      )
    );
    setNewListName("");
  };

  // Add Task form-এর data দিয়ে নতুন task বানায়, first list-এ রাখে, reminder schedule করে।
  const addTask = async (input: NewTaskInput) => {
    if (!activeBoard) return;
    const createdAt = nowIso();
    const newTask: Task = {
      id: makeId("task"),
      title: input.title.trim(),
      description: input.description.trim(),
      assignedTo: input.assignedTo.trim(),
      requiredTime: input.requiredTime.trim(),
      deadline: input.deadline,
      priority: input.priority,
      status: "To Do",
      reminderAt: input.reminderAt,
      comments: [],
      logs: [createLog("Task created")],
      completed: false,
      createdAt,
      updatedAt: createdAt,
    };

    const notificationId = await scheduleReminder(newTask);
    const taskWithNotification = notificationId ? { ...newTask, notificationId } : newTask;

    setBoards((previous) =>
      previous.map((board) =>
        board.id === activeBoard.id
          ? {
              ...board,
              lists: board.lists.map((list, index) =>
                index === 0 ? { ...list, cards: [...list.cards, taskWithNotification] } : list
              ),
            }
          : board
      )
    );
    addNotificationForTask(taskWithNotification);
    setScreen("board");
  };

  // task delete করে এবং তার scheduled notification থাকলে সেটাও cancel করে।
  const deleteTask = (taskId: string) => {
    Alert.alert("Delete task?", "This removes the task, comments, logs, and reminder from this phone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          const task = allTasks.find((item) => item.id === taskId);
          if (task?.notificationId && notificationsRef.current) {
            await notificationsRef.current.cancelScheduledNotificationAsync(task.notificationId).catch(() => undefined);
          }
          setBoards((previous) =>
            previous.map((board) => ({
              ...board,
              lists: board.lists.map((list) => ({
                ...list,
                cards: list.cards.filter((card) => card.id !== taskId),
              })),
            }))
          );
          setNotifications((previous) => previous.filter((item) => item.taskId !== taskId));
          setSelectedTask(null);
        },
      },
    ]);
  };

  // drag-and-drop শেষে একই list-এর card order save করে।
  const reorderList = (listId: string, cards: Task[]) => {
    if (!activeBoard) return;
    setBoards((previous) =>
      previous.map((board) =>
        board.id === activeBoard.id
          ? { ...board, lists: board.lists.map((list) => (list.id === listId ? { ...list, cards } : list)) }
          : board
      )
    );
  };

  // একটি task এক list থেকে অন্য list-এ move করে; Completed list-এ গেলে task completed হয়।
  const moveTaskToList = (taskId: string, targetListId: string) => {
    let movedTask: Task | undefined;
    const targetList = activeBoard?.lists.find((list) => list.id === targetListId);
    if (!activeBoard || !targetList) return;

    setBoards((previous) =>
      previous.map((board) => {
        if (board.id !== activeBoard.id) return board;
        const listsWithoutTask = board.lists.map((list) => {
          const remaining = list.cards.filter((task) => {
            if (task.id === taskId) {
              movedTask = task;
              return false;
            }
            return true;
          });
          return { ...list, cards: remaining };
        });

        if (!movedTask) return board;
        const completed = targetList.title.toLowerCase() === "completed";
        const taskToAdd: Task = {
          ...movedTask,
          status: targetList.title,
          completed,
          updatedAt: nowIso(),
          logs: [...movedTask.logs, createLog(`Task moved to ${targetList.title}`)],
        };

        return {
          ...board,
          lists: listsWithoutTask.map((list) =>
            list.id === targetListId ? { ...list, cards: [...list.cards, taskToAdd] } : list
          ),
        };
      })
    );
  };

  // task detail screen-এর switch দিয়ে completed/incomplete status toggle করে।
  const toggleComplete = (taskId: string, completed: boolean) => {
    const completedList = activeBoard?.lists.find((list) => list.title.toLowerCase() === "completed");
    if (completed && completedList) {
      moveTaskToList(taskId, completedList.id);
      return;
    }

    updateTask(taskId, (task) => ({
      ...task,
      completed,
      updatedAt: nowIso(),
      logs: [...task.logs, createLog(completed ? "Task marked as completed" : "Task marked as incomplete")],
    }));
    setSelectedTask((task) =>
      task?.id === taskId
        ? {
            ...task,
            completed,
            updatedAt: nowIso(),
            logs: [...task.logs, createLog(completed ? "Task marked as completed" : "Task marked as incomplete")],
          }
        : task
    );
  };

  // selected task-এ নতুন comment যোগ করে এবং activity log রাখে।
  const addComment = () => {
    if (!selectedTask || !commentText.trim()) return;
    const comment: Comment = {
      id: makeId("comment"),
      author: commentAuthor.trim() || "You",
      text: commentText.trim(),
      createdAt: nowIso(),
    };
    const nextTask = (task: Task): Task => ({
      ...task,
      comments: [...task.comments, comment],
      logs: [...task.logs, createLog("Comment added")],
      updatedAt: nowIso(),
    });
    updateTask(selectedTask.id, nextTask);
    setSelectedTask(nextTask(selectedTask));
    setCommentText("");
    setCommentAuthor("");
  };

  // bell/radio button দিয়ে notification system test করে; Expo Go/Web হলে in-app fallback দেখায়।
  const sendTestNotification = async () => {
    const module = await ensureNotifications();
    if (!module) {
      setNotifications((previous) => [
        {
          id: makeId("notification"),
          title: "TaskFlow test",
          message: isExpoGo
            ? "Expo Go uses the in-app notification center. Build a development app for device alerts."
            : "Notifications are available in iOS and Android builds.",
          createdAt: nowIso(),
          deliverAt: nowIso(),
          read: false,
          delivered: true,
        },
        ...previous,
      ]);
      setScreen("notifications");
      return;
    }

    try {
      await module.scheduleNotificationAsync({
        content: { title: "TaskFlow test", body: "Notifications are ready.", sound: "default" },
        trigger: { type: module.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 1, channelId: "task-reminders" },
      });
      setNotifications((previous) => [
        {
          id: makeId("notification"),
          title: "TaskFlow test",
          message: "Notifications are ready.",
          createdAt: nowIso(),
          deliverAt: nowIso(),
          read: false,
          delivered: true,
        },
        ...previous,
      ]);
    } catch {
      Alert.alert("Notification failed", "Expo could not schedule the test notification on this device.");
    }
  };

  // modal খোলা থাকলে latest task data দেখাই, যেন move/comment/toggle করার পর detail stale না হয়।
  const selectedTaskLive = selectedTask ? allTasks.find((task) => task.id === selectedTask.id) ?? selectedTask : null;

  return (
    <GestureHandlerRootView style={styles.shell}>
      <KeyboardAvoidingView style={styles.shell} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.app}>
          <Header
            activeBoardTitle={activeBoard?.title ?? "TaskFlow"}
            unread={dashboardStats.unread}
            onNotify={() => setScreen("notifications")}
            onTestNotification={sendTestNotification}
          />

          <NavBar screen={screen} setScreen={setScreen} />

          {screen === "dashboard" && (
            <Dashboard stats={dashboardStats} setScreen={setScreen} />
          )}

          {screen === "boards" && (
            <BoardsScreen
              boards={boards}
              activeBoardId={activeBoard?.id}
              newBoardName={newBoardName}
              setNewBoardName={setNewBoardName}
              addBoard={addBoard}
              openBoard={(id) => {
                setActiveBoardId(id);
                setScreen("board");
              }}
              deleteBoard={deleteBoard}
            />
          )}

          {screen === "board" && activeBoard && (
            <BoardScreen
              board={activeBoard}
              newListName={newListName}
              setNewListName={setNewListName}
              addList={addList}
              reorderList={reorderList}
              moveTaskToList={moveTaskToList}
              openTask={setSelectedTask}
            />
          )}

          {screen === "add" && (
            <AddTaskScreen addTask={addTask} />
          )}

          {screen === "list" && (
            <ListViewScreen boards={boards} openTask={setSelectedTask} />
          )}

          {screen === "notifications" && (
            <NotificationCenter
              notifications={notifications}
              markRead={(id) =>
                setNotifications((previous) =>
                  previous.map((item) => (item.id === id ? { ...item, read: true } : item))
                )
              }
              markAllRead={() =>
                setNotifications((previous) => previous.map((item) => ({ ...item, read: true })))
              }
            />
          )}

          <TaskDetailsModal
            task={selectedTaskLive}
            close={() => setSelectedTask(null)}
            toggleComplete={toggleComplete}
            deleteTask={deleteTask}
            commentAuthor={commentAuthor}
            setCommentAuthor={setCommentAuthor}
            commentText={commentText}
            setCommentText={setCommentText}
            addComment={addComment}
          />
        </View>
      </KeyboardAvoidingView>
    </GestureHandlerRootView>
  );
}

// উপরের header: app title, active board name, notification/test buttons দেখায়।
function Header({
  activeBoardTitle,
  unread,
  onNotify,
  onTestNotification,
}: {
  activeBoardTitle: string;
  unread: number;
  onNotify: () => void;
  onTestNotification: () => void;
}) {
  return (
    <View style={styles.header}>
      <View>
        <Text style={styles.kicker}>TaskFlow Mobile</Text>
        <Text style={styles.title}>{activeBoardTitle}</Text>
      </View>
      <View style={styles.headerActions}>
        <IconButton icon="notifications-outline" label={unread > 0 ? `${unread}` : ""} onPress={onNotify} />
        <IconButton icon="radio-outline" onPress={onTestNotification} />
      </View>
    </View>
  );
}

// screen/tab navigation: Home, Boards, Board, Task, List mode switch করে।
function NavBar({ screen, setScreen }: { screen: Screen; setScreen: (screen: Screen) => void }) {
  // navigation item list এক জায়গায় রাখলে UI render করা সহজ হয়।
  const items: { key: Screen; icon: keyof typeof Ionicons.glyphMap; label: string }[] = [
    { key: "dashboard", icon: "grid-outline", label: "Home" },
    { key: "boards", icon: "albums-outline", label: "Boards" },
    { key: "board", icon: "reader-outline", label: "Board" },
    { key: "add", icon: "add-circle-outline", label: "Task" },
    { key: "list", icon: "list-outline", label: "List" },
  ];

  return (
    <View style={styles.navWrap}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.nav}>
        {items.map((item) => {
          const active = screen === item.key;
          return (
            <TouchableOpacity
              key={item.key}
              style={[styles.navButton, active && styles.navButtonActive]}
              onPress={() => setScreen(item.key)}
            >
              <Ionicons name={item.icon} size={17} color={active ? "#ffffff" : "#475569"} />
              <Text style={[styles.navText, active && styles.navTextActive]}>{item.label}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

// Dashboard screen: total boards/tasks/completed/overdue count এবং quick actions দেখায়।
function Dashboard({
  stats,
  setScreen,
}: {
  stats: { boards: number; tasks: number; completed: number; overdue: number; unread: number };
  setScreen: (screen: Screen) => void;
}) {
  // dashboard statistics card-এর data structure।
  const cards = [
    { label: "Total Boards", value: stats.boards, icon: "albums-outline" },
    { label: "Total Tasks", value: stats.tasks, icon: "checkbox-outline" },
    { label: "Completed Tasks", value: stats.completed, icon: "checkmark-done-outline" },
    { label: "Overdue Tasks", value: stats.overdue, icon: "alert-circle-outline" },
  ] as const;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.dashboardContent}>
      <View style={styles.statGrid}>
        {cards.map((card) => (
          <View key={card.label} style={styles.statCard}>
            <Ionicons name={card.icon} size={22} color="#0f172a" />
            <Text style={styles.statValue}>{card.value}</Text>
            <Text style={styles.statLabel}>{card.label}</Text>
          </View>
        ))}
      </View>

      <View style={styles.quickActions}>
        <QuickAction icon="albums-outline" label="Open Boards" onPress={() => setScreen("boards")} />
        <QuickAction icon="list-outline" label="Open List View" onPress={() => setScreen("list")} />
        <QuickAction icon="notifications-outline" label="Open Notifications" onPress={() => setScreen("notifications")} />
      </View>
    </ScrollView>
  );
}

// Boards screen: সব board list করে, নতুন board বানায়, board open/delete করতে দেয়।
function BoardsScreen({
  boards,
  activeBoardId,
  newBoardName,
  setNewBoardName,
  addBoard,
  openBoard,
  deleteBoard,
}: {
  boards: Board[];
  activeBoardId?: string;
  newBoardName: string;
  setNewBoardName: (value: string) => void;
  addBoard: () => void;
  openBoard: (id: string) => void;
  deleteBoard: (id: string) => void;
}) {
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.inlineForm}>
        <TextInput
          style={styles.inlineInput}
          placeholder="New board name"
          placeholderTextColor="#94a3b8"
          value={newBoardName}
          onChangeText={setNewBoardName}
        />
        <TouchableOpacity style={styles.primarySmallButton} onPress={addBoard}>
          <Ionicons name="add" size={18} color="#ffffff" />
        </TouchableOpacity>
      </View>

      {boards.map((board) => {
        const total = board.lists.reduce((sum, list) => sum + list.cards.length, 0);
        return (
          <View key={board.id} style={styles.boardCard}>
            <TouchableOpacity style={styles.boardCardMain} onPress={() => openBoard(board.id)}>
              <View style={[styles.boardIcon, board.id === activeBoardId && styles.boardIconActive]}>
                <Ionicons name="albums-outline" size={20} color={board.id === activeBoardId ? "#ffffff" : "#0f172a"} />
              </View>
              <View style={styles.flexOne}>
                <Text style={styles.boardTitle}>{board.title}</Text>
                <Text style={styles.boardMeta}>Tasks: {total}</Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity style={styles.dangerIconButton} onPress={() => deleteBoard(board.id)}>
              <Ionicons name="trash-outline" size={18} color="#dc2626" />
            </TouchableOpacity>
          </View>
        );
      })}
    </ScrollView>
  );
}

// Trello-style board screen: horizontal lists, task cards, reorder, move, custom list সব handle করে।
function BoardScreen({
  board,
  newListName,
  setNewListName,
  addList,
  reorderList,
  moveTaskToList,
  openTask,
}: {
  board: Board;
  newListName: string;
  setNewListName: (value: string) => void;
  addList: () => void;
  reorderList: (listId: string, cards: Task[]) => void;
  moveTaskToList: (taskId: string, listId: string) => void;
  openTask: (task: Task) => void;
}) {
  // drag শুরু হলে কোন task কোন list থেকে ধরা হয়েছে সেটা রাখি।
  const [draggedTask, setDraggedTask] = useState<{ task: Task; listId: string } | null>(null);
  const [activeDropListId, setActiveDropListId] = useState<string | null>(null);
  const columnRefs = useRef<Record<string, View | null>>({});
  const dropZonesRef = useRef<Record<string, DropZone>>({});

  // প্রতিটি column screen-এর কোথায় আছে তা মেপে রাখি, যাতে card ছাড়ার সময় target list বুঝতে পারি।
  const measureDropZones = () => {
    Object.entries(columnRefs.current).forEach(([listId, ref]) => {
      ref?.measureInWindow((x, y, width, height) => {
        dropZonesRef.current[listId] = { x, y, width, height };
      });
    });
  };

  // finger/mouse কোন column-এর উপর আছে তা x/y position দিয়ে বের করে।
  const findDropList = (x: number, y: number) => {
    const match = Object.entries(dropZonesRef.current).find(([, zone]) => {
      return x >= zone.x && x <= zone.x + zone.width && y >= zone.y && y <= zone.y + zone.height;
    });
    return match?.[0] ?? null;
  };

  // card drag শুরু হলে active task save করি এবং column drop zone মাপি।
  const startCrossListDrag = (task: Task, listId: string) => {
    setDraggedTask({ task, listId });
    setActiveDropListId(listId);
    requestAnimationFrame(measureDropZones);
  };

  // drag চলার সময় কোন column hover হচ্ছে সেটা highlight করি।
  const updateCrossListDrag = (x: number, y: number) => {
    setActiveDropListId(findDropList(x, y));
  };

  // drag release হলে যদি অন্য list-এর উপর ছাড়া হয়, task সেই list-এ move হয়।
  const finishCrossListDrag = (x: number, y: number) => {
    if (!draggedTask) return;
    const targetListId = findDropList(x, y);
    if (targetListId && targetListId !== draggedTask.listId) {
      moveTaskToList(draggedTask.task.id, targetListId);
    }
    setDraggedTask(null);
    setActiveDropListId(null);
  };

  return (
    <View style={styles.boardScreen}>
      <View style={styles.inlineForm}>
        <TextInput
          style={styles.inlineInput}
          placeholder="Create a custom list"
          placeholderTextColor="#94a3b8"
          value={newListName}
          onChangeText={setNewListName}
        />
        <TouchableOpacity style={styles.primarySmallButton} onPress={addList}>
          <Ionicons name="add" size={18} color="#ffffff" />
        </TouchableOpacity>
      </View>

      {draggedTask && (
        <View style={styles.dropRail}>
          <View style={styles.dropRailTitleRow}>
            <Ionicons name="hand-left-outline" size={16} color="#0f172a" />
            <Text style={styles.dropRailTitle} numberOfLines={1}>
              {activeDropListId && activeDropListId !== draggedTask.listId
                ? `Drop in ${board.lists.find((list) => list.id === activeDropListId)?.title ?? "this list"}`
                : `Drag ${draggedTask.task.title} over another list`}
            </Text>
          </View>
          <Text style={styles.dropRailHelp}>Release the card on a column to move it.</Text>
        </View>
      )}

      <ScrollView horizontal style={styles.boardScroller} contentContainerStyle={styles.boardContent} showsHorizontalScrollIndicator={false}>
        {board.lists.map((list) => {
          const listTheme = getListTheme(list);
          return (
          <View
            key={list.id}
            ref={(ref) => {
              columnRefs.current[list.id] = ref;
            }}
            onLayout={measureDropZones}
            style={[
              styles.column,
              { backgroundColor: listTheme.bg, borderColor: listTheme.border },
              activeDropListId === list.id && styles.columnDropActive,
            ]}
          >
            <View style={styles.columnHeader}>
              <Text style={[styles.columnTitle, { color: listTheme.header }]}>{list.title}</Text>
              <Text style={styles.countBadge}>{list.cards.length}</Text>
            </View>
            <DraggableFlatList
              data={list.cards}
              keyExtractor={(item) => item.id}
              scrollEnabled={false}
              activationDistance={12}
              onDragBegin={(index) => {
                const task = list.cards[index];
                if (task) setDraggedTask({ task, listId: list.id });
              }}
              onDragEnd={({ data }) => {
                reorderList(list.id, data);
                setDraggedTask(null);
              }}
              renderItem={({ item, drag, isActive }: RenderItemParams<Task>) => (
                <TaskCard
                  task={item}
                  currentListId={list.id}
                  onOpen={() => openTask(item)}
                  onDrag={drag}
                  onCrossDragStart={startCrossListDrag}
                  onCrossDragMove={updateCrossListDrag}
                  onCrossDragEnd={finishCrossListDrag}
                  dragging={isActive}
                />
              )}
              ListEmptyComponent={<Text style={styles.emptyColumnText}>No tasks yet</Text>}
            />
          </View>
        );})}
      </ScrollView>
    </View>
  );
}

// Add Task screen: task form নেয়, validate করে, parent app-এ save request পাঠায়।
function AddTaskScreen({ addTask }: { addTask: (task: NewTaskInput) => Promise<void> }) {
  // default deadline আগামীকাল, default reminder এক ঘণ্টা পরে রাখা হয়েছে।
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const reminder = new Date(Date.now() + 60 * 60 * 1000);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [deadlineDate, setDeadlineDate] = useState(toInputDate(tomorrow));
  const [deadlineTime, setDeadlineTime] = useState("18:00");
  const [reminderDate, setReminderDate] = useState(toInputDate(reminder));
  const [reminderTime, setReminderTime] = useState("17:00");
  const [priority, setPriority] = useState<Priority>("Medium");
  const deadlinePreview = useMemo(
    () => parseDateTime(deadlineDate, deadlineTime),
    [deadlineDate, deadlineTime]
  );
  const requiredTime = calculateRequiredTimeFromDeadline(deadlinePreview);

  // preset চাপলে deadline বসে যায় এবং reminder deadline-এর এক ঘণ্টা আগে set হয়।
  const applyDeadlinePreset = (daysFromNow: number, hour: number, minute = 0) => {
    const nextDeadline = new Date();
    nextDeadline.setDate(nextDeadline.getDate() + daysFromNow);
    nextDeadline.setHours(hour, minute, 0, 0);

    if (nextDeadline <= new Date()) {
      nextDeadline.setDate(nextDeadline.getDate() + 1);
    }

    const nextReminder = new Date(nextDeadline.getTime() - 60 * 60 * 1000);
    setDeadlineDate(toInputDate(nextDeadline));
    setDeadlineTime(toInputTime(nextDeadline));
    setReminderDate(toInputDate(nextReminder));
    setReminderTime(toInputTime(nextReminder));
  };

  // form submit: required field/date/reminder validate করে নতুন task তৈরি করে।
  const submit = async () => {
    const deadline = parseDateTime(deadlineDate, deadlineTime);
    const reminderAt = parseDateTime(reminderDate, reminderTime);
    if (!title.trim()) {
      Alert.alert("Task title required", "Add a clear title before saving.");
      return;
    }
    if (!deadline || !reminderAt) {
      Alert.alert("Invalid date", "Use YYYY-MM-DD for dates and HH:MM for time.");
      return;
    }
    if (reminderAt > deadline) {
      Alert.alert("Reminder is after deadline", "Set the reminder before the deadline.");
      return;
    }

    await addTask({
      title,
      description,
      assignedTo,
      requiredTime,
      deadline: deadline.toISOString(),
      reminderAt: reminderAt.toISOString(),
      priority,
    });

    setTitle("");
    setDescription("");
    setAssignedTo("");
    setDeadlineDate(toInputDate(tomorrow));
    setDeadlineTime("18:00");
    setReminderDate(toInputDate(reminder));
    setReminderTime("17:00");
    setPriority("Medium");
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.formContent} keyboardShouldPersistTaps="handled">
      <FormInput label="Task Title" value={title} onChangeText={setTitle} placeholder="Design database schema" />
      <FormInput label="Description" value={description} onChangeText={setDescription} placeholder="Add context, links, or acceptance notes" multiline />
      <FormInput label="Assigned User" value={assignedTo} onChangeText={setAssignedTo} placeholder="Ashik" />

      <View style={styles.inputGroup}>
        <Text style={styles.inputLabel}>Deadline</Text>
        <View style={styles.deadlinePresetRow}>
          <TouchableOpacity style={styles.deadlinePresetButton} onPress={() => applyDeadlinePreset(0, 21)}>
            <Text style={styles.deadlinePresetText}>Tonight</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.deadlinePresetButton} onPress={() => applyDeadlinePreset(1, 18)}>
            <Text style={styles.deadlinePresetText}>Tomorrow</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.deadlinePresetButton} onPress={() => applyDeadlinePreset(3, 18)}>
            <Text style={styles.deadlinePresetText}>3 Days</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.deadlinePresetButton} onPress={() => applyDeadlinePreset(7, 18)}>
            <Text style={styles.deadlinePresetText}>Next Week</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.doubleRow}>
          <TextInput style={styles.input} value={deadlineDate} onChangeText={setDeadlineDate} placeholder="YYYY-MM-DD" placeholderTextColor="#94a3b8" />
          <TextInput style={styles.input} value={deadlineTime} onChangeText={setDeadlineTime} placeholder="HH:MM" placeholderTextColor="#94a3b8" />
        </View>
      </View>

      <View style={styles.inputGroup}>
        <Text style={styles.inputLabel}>Required Time</Text>
        <View style={styles.calculatedTimeBox}>
          <Ionicons name="hourglass-outline" size={18} color="#0f766e" />
          <Text style={styles.calculatedTimeText}>{requiredTime}</Text>
        </View>
      </View>

      <View style={styles.inputGroup}>
        <Text style={styles.inputLabel}>Reminder Time</Text>
        <View style={styles.doubleRow}>
          <TextInput style={styles.input} value={reminderDate} onChangeText={setReminderDate} placeholder="YYYY-MM-DD" placeholderTextColor="#94a3b8" />
          <TextInput style={styles.input} value={reminderTime} onChangeText={setReminderTime} placeholder="HH:MM" placeholderTextColor="#94a3b8" />
        </View>
      </View>

      <View style={styles.inputGroup}>
        <Text style={styles.inputLabel}>Priority</Text>
        <View style={styles.priorityRow}>
          {(["Low", "Medium", "High", "Urgent"] as Priority[]).map((item) => {
            const theme = getPriorityTheme(item);
            const active = priority === item;
            return (
              <TouchableOpacity
                key={item}
                style={[styles.priorityButton, active && { backgroundColor: theme.bg, borderColor: theme.text }]}
                onPress={() => setPriority(item)}
              >
                <Text style={[styles.priorityButtonText, active && { color: theme.text }]}>{item}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      <TouchableOpacity style={styles.submitButton} onPress={submit}>
        <Ionicons name="save-outline" size={18} color="#ffffff" />
        <Text style={styles.submitButtonText}>Save Task</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

// List View screen: সব board-এর task একসাথে deadline অনুযায়ী sort করে দেখায়।
function ListViewScreen({ boards, openTask }: { boards: Board[]; openTask: (task: Task) => void }) {
  const [search, setSearch] = useState("");

  // search text অনুযায়ী filter করে nearest deadline first order-এ সাজায়।
  const tasks = boards
    .flatMap((board) =>
      board.lists.flatMap((list) => list.cards.map((task) => ({ ...task, boardTitle: board.title, listTitle: list.title })))
    )
    .filter((task) => task.title.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => new Date(a.deadline).getTime() - new Date(b.deadline).getTime());

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.searchBox}>
        <Ionicons name="search-outline" size={18} color="#64748b" />
        <TextInput style={styles.searchInput} value={search} onChangeText={setSearch} placeholder="Search tasks by title" placeholderTextColor="#94a3b8" />
      </View>
      {tasks.map((task) => (
        <View key={task.id} style={styles.listTaskWrap}>
          <Text style={styles.contextText}>{task.boardTitle} / {task.listTitle}</Text>
          <TaskCard task={task} onOpen={() => openTask(task)} />
        </View>
      ))}
      {tasks.length === 0 && <Text style={styles.emptyText}>No matching tasks.</Text>}
    </ScrollView>
  );
}

// Notification Center: সব reminder/test notification, unread status, mark read actions দেখায়।
function NotificationCenter({
  notifications,
  markRead,
  markAllRead,
}: {
  notifications: NotificationItem[];
  markRead: (id: string) => void;
  markAllRead: () => void;
}) {
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Notifications</Text>
        <TouchableOpacity style={styles.secondaryButton} onPress={markAllRead}>
          <Text style={styles.secondaryButtonText}>Mark all read</Text>
        </TouchableOpacity>
      </View>
      {notifications.map((item) => (
        <TouchableOpacity key={item.id} style={[styles.notificationCard, !item.read && styles.notificationUnread]} onPress={() => markRead(item.id)}>
          <View style={styles.notificationIcon}>
            <Ionicons name={item.delivered ? "notifications" : "time-outline"} size={18} color="#0f172a" />
          </View>
          <View style={styles.flexOne}>
            <Text style={styles.notificationTitle}>{item.title}</Text>
            <Text style={styles.notificationMessage}>{item.message}</Text>
            <Text style={styles.contextText}>{item.delivered ? formatDateTime(item.createdAt) : `Scheduled ${formatDateTime(item.deliverAt)}`}</Text>
          </View>
          {!item.read && <View style={styles.unreadDot} />}
        </TouchableOpacity>
      ))}
      {notifications.length === 0 && <Text style={styles.emptyText}>No notifications yet.</Text>}
    </ScrollView>
  );
}

// Task detail modal: task details, status move, complete switch, comments, activity logs দেখায়।
function TaskDetailsModal({
  task,
  close,
  toggleComplete,
  deleteTask,
  commentAuthor,
  setCommentAuthor,
  commentText,
  setCommentText,
  addComment,
}: {
  task: Task | null;
  close: () => void;
  toggleComplete: (taskId: string, completed: boolean) => void;
  deleteTask: (taskId: string) => void;
  commentAuthor: string;
  setCommentAuthor: (value: string) => void;
  commentText: string;
  setCommentText: (value: string) => void;
  addComment: () => void;
}) {
  if (!task) return null;
  // detail header/card-এর color task state অনুযায়ী একই theme ব্যবহার করে।
  const theme = getCardTheme(task);

  return (
    <Modal visible={!!task} animationType="slide" onRequestClose={close}>
      <View style={styles.modalShell}>
        <View style={styles.modalHeader}>
          <TouchableOpacity style={styles.closeButton} onPress={close}>
            <Ionicons name="close" size={22} color="#0f172a" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.deleteButton} onPress={() => deleteTask(task.id)}>
            <Ionicons name="trash-outline" size={18} color="#dc2626" />
            <Text style={styles.deleteButtonText}>Delete</Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled">
          <View style={[styles.detailHero, { borderColor: theme.border, backgroundColor: theme.bg }]}>
            <PriorityBadge priority={task.priority} />
            <Text style={styles.detailTitle}>{task.title}</Text>
            <Text style={styles.detailDescription}>{task.description || "No description added."}</Text>
          </View>

          <View style={styles.detailGrid}>
            <DetailItem icon="person-outline" label="Assigned" value={task.assignedTo || "Unassigned"} />
            <DetailItem icon="timer-outline" label="Required Time" value={task.requiredTime || "N/A"} />
            <DetailItem icon="calendar-outline" label="Deadline" value={formatDateTime(task.deadline)} />
            <DetailItem icon="alarm-outline" label="Reminder" value={formatDateTime(task.reminderAt)} />
            <DetailItem icon="trending-up-outline" label="Status" value={task.status} />
            <DetailItem icon="hourglass-outline" label="Remaining" value={getRemainingTime(task)} />
          </View>

          <View style={styles.switchRow}>
            <Text style={styles.sectionTitle}>Completion status</Text>
            <Switch value={task.completed} onValueChange={(value) => toggleComplete(task.id, value)} />
          </View>

          <Text style={styles.sectionTitle}>Comments</Text>
          <TextInput style={styles.input} value={commentAuthor} onChangeText={setCommentAuthor} placeholder="Commenter name" placeholderTextColor="#94a3b8" />
          <TextInput
            style={[styles.input, styles.commentInput]}
            value={commentText}
            onChangeText={setCommentText}
            placeholder="Add a comment"
            placeholderTextColor="#94a3b8"
            multiline
          />
          <TouchableOpacity style={styles.secondaryButtonWide} onPress={addComment}>
            <Text style={styles.secondaryButtonText}>Add Comment</Text>
          </TouchableOpacity>
          {task.comments.map((comment) => (
            <View key={comment.id} style={styles.commentCard}>
              <Text style={styles.commentAuthor}>{comment.author}</Text>
              <Text style={styles.commentText}>{comment.text}</Text>
              <Text style={styles.contextText}>{formatDateTime(comment.createdAt)}</Text>
            </View>
          ))}

          <Text style={styles.sectionTitle}>Activity Logs</Text>
          {task.logs.slice().reverse().map((log) => (
            <View key={log.id} style={styles.logRow}>
              <View style={styles.logDot} />
              <View>
                <Text style={styles.logAction}>{log.action}</Text>
                <Text style={styles.contextText}>{formatDateTime(log.createdAt)}</Text>
              </View>
            </View>
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
}

// TaskCard: board/list view-তে task summary দেখায়, open, long-press drag এবং quick move handle করে।
function TaskCard({
  task,
  currentListId,
  onOpen,
  onDrag,
  onCrossDragStart,
  onCrossDragMove,
  onCrossDragEnd,
  dragging,
}: {
  task: Task;
  currentListId?: string;
  onOpen: () => void;
  onDrag?: () => void;
  onCrossDragStart?: (task: Task, listId: string) => void;
  onCrossDragMove?: (x: number, y: number) => void;
  onCrossDragEnd?: (x: number, y: number) => void;
  dragging?: boolean;
}) {
  // card color deadline/completion অনুযায়ী update হয়।
  const theme = getCardTheme(task);

  // drag handle দিয়ে card অন্য column-এর উপর নিয়ে গেলে x/y position parent board-এ পাঠাই।
  const crossListResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (event) => {
          if (!currentListId) return;
          onCrossDragStart?.(task, currentListId);
          onCrossDragMove?.(event.nativeEvent.pageX, event.nativeEvent.pageY);
        },
        onPanResponderMove: (event) => {
          onCrossDragMove?.(event.nativeEvent.pageX, event.nativeEvent.pageY);
        },
        onPanResponderRelease: (event) => {
          onCrossDragEnd?.(event.nativeEvent.pageX, event.nativeEvent.pageY);
        },
        onPanResponderTerminate: (event) => {
          onCrossDragEnd?.(event.nativeEvent.pageX, event.nativeEvent.pageY);
        },
      }),
    [currentListId, onCrossDragEnd, onCrossDragMove, onCrossDragStart, task]
  );

  return (
    <View
      style={[styles.taskCard, { backgroundColor: theme.bg, borderColor: theme.border }, dragging && styles.taskCardDragging]}
    >
      <Pressable onPress={onOpen} onLongPress={onDrag} delayLongPress={180}>
        <View style={styles.cardTop}>
          <PriorityBadge priority={task.priority} />
          <View style={styles.cardTopRight}>
            <Text style={[styles.remainingText, { color: theme.accent }]}>{getRemainingTime(task)}</Text>
            {onDrag && (
              <View style={styles.dragHandle} {...crossListResponder.panHandlers}>
                <Ionicons name="reorder-three-outline" size={18} color="#475569" />
                <Text style={styles.dragHandleText}>Drag</Text>
              </View>
            )}
          </View>
        </View>
        <Text style={styles.taskTitle}>{task.title}</Text>
        <Text style={styles.taskDescription} numberOfLines={2}>{task.description || "No description"}</Text>
        <View style={styles.metaRow}>
          <Ionicons name="person-outline" size={14} color="#64748b" />
          <Text style={styles.metaText}>{task.assignedTo || "Unassigned"}</Text>
        </View>
        <View style={styles.metaRow}>
          <Ionicons name="calendar-outline" size={14} color="#64748b" />
          <Text style={styles.metaText}>{formatDateTime(task.deadline)}</Text>
        </View>
        <View style={styles.metaRow}>
          <Ionicons name="timer-outline" size={14} color="#64748b" />
          <Text style={styles.metaText}>{task.requiredTime || "No estimate"}</Text>
        </View>
      </Pressable>
    </View>
  );
}

// Priority badge: Low/Medium/High/Urgent priority color সহ দেখায়।
function PriorityBadge({ priority }: { priority: Priority }) {
  // priority অনুযায়ী badge color বের করি।
  const theme = getPriorityTheme(priority);
  return (
    <View style={[styles.priorityBadge, { backgroundColor: theme.bg }]}>
      <Text style={[styles.priorityBadgeText, { color: theme.text }]}>{priority}</Text>
    </View>
  );
}

// DetailItem: task detail modal-এর ছোট info tile, যেমন Assigned/Deadline/Status।
function DetailItem({ icon, label, value }: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string }) {
  return (
    <View style={styles.detailItem}>
      <Ionicons name={icon} size={17} color="#475569" />
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

// FormInput: repeated text input UI reuse করার ছোট component।
function FormInput({
  label,
  value,
  onChangeText,
  placeholder,
  multiline,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  multiline?: boolean;
}) {
  return (
    <View style={styles.inputGroup}>
      <Text style={styles.inputLabel}>{label}</Text>
      <TextInput
        style={[styles.input, multiline && styles.multilineInput]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#94a3b8"
        multiline={multiline}
      />
    </View>
  );
}

// QuickAction: dashboard-এর বড় action row, যেমন Open Boards/List/Notifications।
function QuickAction({ icon, label, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.quickAction} onPress={onPress}>
      <Ionicons name={icon} size={20} color="#0f172a" />
      <Text style={styles.quickActionText}>{label}</Text>
      <Ionicons name="chevron-forward" size={18} color="#64748b" />
    </TouchableOpacity>
  );
}

// IconButton: header-এর icon-only button, optional unread badge সহ।
function IconButton({ icon, label, onPress }: { icon: keyof typeof Ionicons.glyphMap; label?: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.iconButton} onPress={onPress}>
      <Ionicons name={icon} size={20} color="#0f172a" />
      {!!label && (
        <View style={styles.iconBadge}>
          <Text style={styles.iconBadgeText}>{label}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

// পুরো app-এর visual design/style rules এখানে রাখা হয়েছে।
const styles = StyleSheet.create({
  shell: {
    flex: 1,
    backgroundColor: "#f8fafc",
  },
  app: {
    flex: 1,
    paddingTop: Platform.OS === "android" ? 38 : 54,
    backgroundColor: "#f8fafc",
  },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  kicker: {
    color: "#0f766e",
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  title: {
    color: "#0f172a",
    fontSize: 24,
    fontWeight: "800",
    marginTop: 2,
  },
  headerActions: {
    flexDirection: "row",
    gap: 10,
  },
  iconButton: {
    width: 42,
    height: 42,
    borderRadius: 8,
    backgroundColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  iconBadge: {
    position: "absolute",
    right: -4,
    top: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "#ef4444",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  iconBadgeText: {
    color: "#ffffff",
    fontSize: 10,
    fontWeight: "800",
  },
  navWrap: {
    paddingBottom: 12,
  },
  nav: {
    paddingHorizontal: 20,
    gap: 8,
  },
  navButton: {
    height: 38,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  navButtonActive: {
    backgroundColor: "#0f172a",
    borderColor: "#0f172a",
  },
  navText: {
    color: "#475569",
    fontSize: 13,
    fontWeight: "700",
  },
  navTextActive: {
    color: "#ffffff",
  },
  screen: {
    flex: 1,
  },
  content: {
    padding: 20,
    paddingBottom: 120,
  },
  dashboardContent: {
    padding: 20,
    paddingBottom: 120,
    gap: 18,
  },
  statGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  statCard: {
    width: "48%",
    minHeight: 126,
    borderRadius: 8,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    padding: 16,
    justifyContent: "space-between",
  },
  statValue: {
    color: "#0f172a",
    fontSize: 30,
    fontWeight: "900",
  },
  statLabel: {
    color: "#64748b",
    fontSize: 13,
    fontWeight: "700",
  },
  quickActions: {
    gap: 10,
  },
  quickAction: {
    minHeight: 58,
    borderRadius: 8,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  quickActionText: {
    flex: 1,
    color: "#0f172a",
    fontSize: 15,
    fontWeight: "800",
  },
  inlineForm: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 20,
    marginBottom: 14,
  },
  inlineInput: {
    flex: 1,
    height: 46,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#cbd5e1",
    backgroundColor: "#ffffff",
    paddingHorizontal: 14,
    color: "#0f172a",
    fontSize: 14,
  },
  primarySmallButton: {
    width: 48,
    height: 46,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0f172a",
  },
  boardCard: {
    minHeight: 78,
    borderRadius: 8,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    padding: 14,
    marginBottom: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  boardCardMain: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flex: 1,
  },
  boardIcon: {
    width: 42,
    height: 42,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f1f5f9",
  },
  boardIconActive: {
    backgroundColor: "#0f766e",
  },
  boardTitle: {
    color: "#0f172a",
    fontSize: 16,
    fontWeight: "800",
  },
  boardMeta: {
    color: "#64748b",
    marginTop: 3,
    fontWeight: "600",
  },
  dangerIconButton: {
    width: 38,
    height: 38,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fef2f2",
  },
  flexOne: {
    flex: 1,
  },
  boardScreen: {
    flex: 1,
  },
  boardScroller: {
    flex: 1,
  },
  boardContent: {
    paddingHorizontal: 20,
    paddingBottom: 120,
    gap: 14,
  },
  dropRail: {
    marginHorizontal: 20,
    marginBottom: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#f97316",
    backgroundColor: "#fff7ed",
    padding: 10,
  },
  dropRailTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    marginBottom: 8,
  },
  dropRailTitle: {
    flex: 1,
    color: "#0f172a",
    fontWeight: "900",
    fontSize: 13,
  },
  dropRailHelp: {
    color: "#9a3412",
    fontSize: 12,
    fontWeight: "700",
  },
  column: {
    width: 292,
    borderRadius: 8,
    backgroundColor: "#eef2f7",
    borderWidth: 1,
    borderColor: "#dbe3ef",
    padding: 12,
    alignSelf: "flex-start",
    minHeight: 360,
  },
  columnDropActive: {
    borderColor: "#0f766e",
    borderWidth: 2,
    transform: [{ scale: 1.01 }],
  },
  columnHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  columnTitle: {
    color: "#0f172a",
    fontSize: 13,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  countBadge: {
    minWidth: 26,
    textAlign: "center",
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: "#ffffff",
    color: "#475569",
    fontWeight: "900",
    paddingVertical: 3,
  },
  emptyColumnText: {
    color: "#64748b",
    fontWeight: "700",
    paddingVertical: 20,
    textAlign: "center",
  },
  taskCard: {
    borderRadius: 8,
    borderWidth: 1,
    padding: 14,
    marginBottom: 12,
  },
  taskCardDragging: {
    opacity: 0.75,
    transform: [{ scale: 1.02 }],
  },
  cardTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  cardTopRight: {
    alignItems: "flex-end",
    gap: 6,
  },
  dragHandle: {
    minHeight: 28,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: "rgba(100, 116, 139, 0.35)",
    backgroundColor: "rgba(255, 255, 255, 0.75)",
    paddingHorizontal: 7,
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  dragHandleText: {
    color: "#475569",
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  priorityBadge: {
    alignSelf: "flex-start",
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  priorityBadgeText: {
    fontSize: 11,
    fontWeight: "900",
  },
  remainingText: {
    fontSize: 11,
    fontWeight: "900",
  },
  taskTitle: {
    color: "#0f172a",
    fontSize: 16,
    fontWeight: "900",
    marginTop: 12,
  },
  taskDescription: {
    color: "#475569",
    fontSize: 13,
    lineHeight: 18,
    marginTop: 5,
    marginBottom: 10,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 4,
  },
  metaText: {
    color: "#475569",
    fontSize: 12,
    fontWeight: "600",
  },
  formContent: {
    padding: 20,
    paddingBottom: 120,
  },
  inputGroup: {
    marginBottom: 16,
  },
  inputLabel: {
    color: "#334155",
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase",
    marginBottom: 7,
  },
  input: {
    flex: 1,
    minHeight: 46,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#cbd5e1",
    backgroundColor: "#ffffff",
    paddingHorizontal: 14,
    paddingVertical: 11,
    color: "#0f172a",
    fontSize: 14,
  },
  multilineInput: {
    minHeight: 92,
    textAlignVertical: "top",
  },
  doubleRow: {
    flexDirection: "row",
    gap: 10,
  },
  deadlinePresetRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 10,
  },
  deadlinePresetButton: {
    flexGrow: 1,
    minWidth: "22%",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#99f6e4",
    backgroundColor: "#f0fdfa",
    paddingVertical: 10,
    alignItems: "center",
  },
  deadlinePresetText: {
    color: "#0f766e",
    fontSize: 12,
    fontWeight: "900",
  },
  calculatedTimeBox: {
    minHeight: 46,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#99f6e4",
    backgroundColor: "#f0fdfa",
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  calculatedTimeText: {
    color: "#0f172a",
    fontSize: 14,
    fontWeight: "900",
  },
  priorityRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  priorityButton: {
    flexGrow: 1,
    minWidth: "23%",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#cbd5e1",
    backgroundColor: "#ffffff",
    paddingVertical: 11,
    alignItems: "center",
  },
  priorityButtonText: {
    color: "#475569",
    fontWeight: "900",
    fontSize: 12,
  },
  submitButton: {
    height: 50,
    borderRadius: 8,
    backgroundColor: "#0f172a",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    marginTop: 8,
  },
  submitButtonText: {
    color: "#ffffff",
    fontWeight: "900",
    fontSize: 15,
  },
  searchBox: {
    height: 48,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#cbd5e1",
    backgroundColor: "#ffffff",
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 16,
  },
  searchInput: {
    flex: 1,
    color: "#0f172a",
    fontSize: 14,
  },
  listTaskWrap: {
    marginBottom: 10,
  },
  contextText: {
    color: "#64748b",
    fontSize: 12,
    fontWeight: "700",
    marginBottom: 6,
  },
  emptyText: {
    color: "#64748b",
    textAlign: "center",
    marginTop: 32,
    fontWeight: "700",
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  sectionTitle: {
    color: "#0f172a",
    fontSize: 16,
    fontWeight: "900",
    marginTop: 18,
    marginBottom: 10,
  },
  secondaryButton: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#cbd5e1",
    backgroundColor: "#ffffff",
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  secondaryButtonWide: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#cbd5e1",
    backgroundColor: "#ffffff",
    paddingHorizontal: 12,
    paddingVertical: 12,
    alignItems: "center",
    marginTop: 10,
  },
  secondaryButtonText: {
    color: "#0f172a",
    fontWeight: "900",
  },
  notificationCard: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    backgroundColor: "#ffffff",
    padding: 14,
    marginBottom: 10,
    flexDirection: "row",
    gap: 12,
    alignItems: "center",
  },
  notificationUnread: {
    borderColor: "#38bdf8",
    backgroundColor: "#f0f9ff",
  },
  notificationIcon: {
    width: 38,
    height: 38,
    borderRadius: 8,
    backgroundColor: "#e2e8f0",
    alignItems: "center",
    justifyContent: "center",
  },
  notificationTitle: {
    color: "#0f172a",
    fontSize: 15,
    fontWeight: "900",
  },
  notificationMessage: {
    color: "#475569",
    marginTop: 3,
    marginBottom: 5,
    fontWeight: "600",
  },
  unreadDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#0ea5e9",
  },
  modalShell: {
    flex: 1,
    backgroundColor: "#f8fafc",
    paddingTop: Platform.OS === "android" ? 34 : 54,
  },
  modalHeader: {
    paddingHorizontal: 20,
    paddingBottom: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  closeButton: {
    width: 42,
    height: 42,
    borderRadius: 8,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    alignItems: "center",
    justifyContent: "center",
  },
  deleteButton: {
    height: 42,
    borderRadius: 8,
    backgroundColor: "#fef2f2",
    paddingHorizontal: 12,
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
  },
  deleteButtonText: {
    color: "#dc2626",
    fontWeight: "900",
  },
  modalContent: {
    padding: 20,
    paddingBottom: 120,
  },
  detailHero: {
    borderRadius: 8,
    borderWidth: 1,
    padding: 16,
  },
  detailTitle: {
    color: "#0f172a",
    fontSize: 24,
    fontWeight: "900",
    marginTop: 12,
  },
  detailDescription: {
    color: "#475569",
    fontSize: 14,
    lineHeight: 21,
    marginTop: 8,
    fontWeight: "600",
  },
  detailGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 16,
  },
  detailItem: {
    width: "48%",
    minHeight: 94,
    borderRadius: 8,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    padding: 12,
  },
  detailLabel: {
    color: "#64748b",
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
    marginTop: 8,
  },
  detailValue: {
    color: "#0f172a",
    fontSize: 13,
    fontWeight: "800",
    marginTop: 4,
  },
  switchRow: {
    minHeight: 54,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  commentInput: {
    marginTop: 10,
    minHeight: 84,
    textAlignVertical: "top",
  },
  commentCard: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    backgroundColor: "#ffffff",
    padding: 12,
    marginTop: 10,
  },
  commentAuthor: {
    color: "#0f172a",
    fontWeight: "900",
    marginBottom: 4,
  },
  commentText: {
    color: "#475569",
    fontWeight: "600",
    lineHeight: 20,
    marginBottom: 8,
  },
  logRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 12,
  },
  logDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#0f766e",
    marginTop: 4,
  },
  logAction: {
    color: "#0f172a",
    fontWeight: "900",
  },
});
