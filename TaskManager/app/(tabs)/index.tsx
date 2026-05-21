import React, { useEffect, useRef, useState } from "react";
import {
  Platform,
  View,
  Text,
  TextInput,
  Button,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  KeyboardAvoidingView,
} from "react-native";
import {
  GestureHandlerRootView,
  PanGestureHandler,
  State,
} from "react-native-gesture-handler";

type Task = {
  id: string;
  title: string;
  assignedTo: string;
  requiredTime: string;
  deadline: string;
  priority: string;
  comments: string[];
  logs: string[];
  completed: boolean;
};

type NewTaskInput = {
  title: string;
  assignedTo: string;
  requiredTime: string;
  deadline: string;
  priority: string;
};

type TaskList = {
  id: string;
  title: string;
  cards: Task[];
};

type Board = {
  id: string;
  title: string;
  lists: TaskList[];
};

type NotificationsModule = typeof import("expo-notifications");

const createDefaultLists = (): TaskList[] => [
  { id: "todo", title: "To Do", cards: [] },
  { id: "doing", title: "Doing", cards: [] },
  { id: "done", title: "Done", cards: [] },
];

const initialBoards: Board[] = [
  { id: "board-1", title: "Project Board", lists: createDefaultLists() },
];

export default function App() {
  const [boards, setBoards] = useState<Board[]>(initialBoards);
  const [activeBoardId, setActiveBoardId] = useState(initialBoards[0].id);
  const [screen, setScreen] = useState<"board" | "add" | "list">("board");
  const [newBoardName, setNewBoardName] = useState("");
  const [newListName, setNewListName] = useState("");
  const notificationsRef = useRef<NotificationsModule | null>(null);

  const ensureNotifications = async () => {
    if (Platform.OS === "web") return;

    const module = await import("expo-notifications");
    notificationsRef.current = module;
    module.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });

    try {
      const current = await module.getPermissionsAsync();
      if (current.status !== "granted") {
        const requested = await module.requestPermissionsAsync();
        if (requested.status !== "granted" && !requested.granted) {
          Alert.alert(
            "Notifications Disabled",
            "Please enable notifications in system settings to receive reminders."
          );
        }
      }

      if (Platform.OS === "android") {
        try {
          await module.setNotificationChannelAsync("default", {
            name: "Default",
            importance: module.AndroidImportance?.MAX ?? 5,
            sound: "default",
          });
        } catch {}
      }
    } catch {
      // ignore permission errors in some environments (Expo Go web/dev)
    }
  };

  useEffect(() => {
    ensureNotifications();
  }, []);

  const activeBoard = boards.find((board) => board.id === activeBoardId) ?? boards[0];

  const updateBoardLists = (lists: TaskList[]) => {
    setBoards((prev) =>
      prev.map((board) =>
        board.id === activeBoard.id ? { ...board, lists } : board
      )
    );
  };

  const dropZones = useRef<Record<string, { x: number; y: number; width: number; height: number }>>({});
  const [draggingTask, setDraggingTask] = useState<Task | null>(null);
  const [dragOriginListId, setDragOriginListId] = useState<string | null>(null);
  const [dragPosition, setDragPosition] = useState({ x: 0, y: 0 });
  const [activeDropListId, setActiveDropListId] = useState<string | null>(null);
  const listRefs = useRef<Record<string, any | null>>({});

  const measureDropZones = () => {
    Object.entries(listRefs.current).forEach(([listId, ref]) => {
      if (!ref || typeof ref.measureInWindow !== "function") return;
      ref.measureInWindow((x: number, y: number, width: number, height: number) => {
        dropZones.current[listId] = { x, y, width, height };
      });
    });
  };

  const findDropListForPosition = (x: number, y: number) => {
    const zoneEntry = Object.entries(dropZones.current).find(([, zone]) => {
      return x >= zone.x && x <= zone.x + zone.width && y >= zone.y && y <= zone.y + zone.height;
    });
    return zoneEntry ? zoneEntry[0] : null;
  };

  const moveTaskBetweenLists = (taskId: string, fromListId: string, toListId: string) => {
    let movedTask: Task | null = null;

    const nextLists = activeBoard.lists.map((list) => {
      if (list.id !== fromListId) return list;

      const remainingCards = list.cards.filter((card) => {
        if (card.id === taskId) {
          movedTask = card;
          return false;
        }
        return true;
      });

      return { ...list, cards: remainingCards };
    });

    if (!movedTask) {
      return;
    }

    const taskToAdd = movedTask as Task;
    if (fromListId === toListId) {
      updateBoardLists(nextLists);
      return;
    }

    const completedTask =
      toListId === "done" && !taskToAdd.completed
        ? {
            ...taskToAdd,
            completed: true,
            logs: [
              ...taskToAdd.logs,
              `Moved to Done at ${new Date().toLocaleString()}`,
            ],
          }
        : taskToAdd;

    updateBoardLists(
      nextLists.map((list) =>
        list.id === toListId
          ? { ...list, cards: [...list.cards, completedTask] }
          : list
      )
    );
  };

  const handleDragMove = (x: number, y: number) => {
    setDragPosition({ x, y });
    const target = findDropListForPosition(x, y);
    setActiveDropListId(target);
  };

  const handleDragEnd = () => {
    if (draggingTask && dragOriginListId && activeDropListId) {
      moveTaskBetweenLists(draggingTask.id, dragOriginListId, activeDropListId);
    }
    setDraggingTask(null);
    setDragOriginListId(null);
    setActiveDropListId(null);
    setDragPosition({ x: 0, y: 0 });
  };

  const startDrag = (task: Task, listId: string, x: number, y: number) => {
    setDraggingTask(task);
    setDragOriginListId(listId);
    setDragPosition({ x, y });
    setActiveDropListId(listId);
    measureDropZones();
  };

  const addTaskLog = (taskId: string) => {
    updateBoardLists(
      activeBoard.lists.map((current) => ({
        ...current,
        cards: current.cards.map((item) =>
          item.id === taskId
            ? {
                ...item,
                logs: [
                  ...item.logs,
                  `Note added at ${new Date().toLocaleString()}`,
                ],
              }
            : item
        ),
      }))
    );
  };

  const addTask = async (task: NewTaskInput) => {
    const newTask: Task = {
      id: Date.now().toString(),
      title: task.title,
      assignedTo: task.assignedTo,
      requiredTime: task.requiredTime,
      deadline: task.deadline,
      priority: task.priority,
      comments: [],
      logs: [`Task created at ${new Date().toLocaleString()}`],
      completed: false,
    };

    updateBoardLists(
      activeBoard.lists.map((list) =>
        list.id === "todo"
          ? { ...list, cards: [...list.cards, newTask] }
          : list
      )
    );

    await scheduleReminder(newTask);
  };

  const scheduleReminder = async (task: Task) => {
    const deadlineDate = new Date(task.deadline);
    const now = new Date();

    if (isNaN(deadlineDate.getTime()) || deadlineDate <= now) return;

    const reminderTime = new Date(deadlineDate.getTime() - 60 * 60 * 1000);
    const bodyText = reminderTime <= now
      ? `${task.title} is due in less than an hour!`
      : `${task.title} is due in one hour!`;

    if (!notificationsRef.current) return;

    const secondsUntilTrigger = Math.max(
      Math.floor((reminderTime.getTime() - now.getTime()) / 1000),
      1
    );

    try {
      await notificationsRef.current.scheduleNotificationAsync({
        content: {
          title: "Task Reminder",
          body: bodyText,
          data: { taskId: task.id },
        },
        trigger: { seconds: secondsUntilTrigger, repeats: false } as any,
      });
    } catch {
      // ignore scheduling failures for now
    }
  };

  const sendTestNotification = async () => {
    await ensureNotifications();

    if (!notificationsRef.current) {
      Alert.alert("Notifications unavailable", "Notifications are not available on this platform.");
      return;
    }

    try {
      await notificationsRef.current.scheduleNotificationAsync({
        content: { title: "Test Reminder", body: "This is a test notification." },
        trigger: { seconds: 1, repeats: false } as any,
      });
    } catch {
      Alert.alert("Error", "Failed to send test notification.");
    }
  };

  const moveToDone = (cardId: string) => {
    let movedTask: Task | null = null;

    const nextLists = activeBoard.lists.map((list) => {
      const remainingCards = list.cards.filter((card) => {
        if (card.id === cardId) {
          movedTask = {
            ...card,
            completed: true,
            logs: [
              ...card.logs,
              `Task completed at ${new Date().toLocaleString()}`,
            ],
          };
          return false;
        }
        return true;
      });

      return { ...list, cards: remainingCards };
    });

    updateBoardLists(
      nextLists.map((list) =>
        list.id === "done" && movedTask
          ? { ...list, cards: [...list.cards, movedTask] }
          : list
      )
    );
  };

  const activeBoardLists = activeBoard.lists;
  const totalTasks = activeBoardLists.reduce((sum, list) => sum + list.cards.length, 0);
  const overdueCount = activeBoardLists
    .flatMap((list) => list.cards)
    .filter((task) => {
      const deadline = new Date(task.deadline);
      return !task.completed && !isNaN(deadline.getTime()) && deadline < new Date();
    }).length;
  const dueSoonCount = activeBoardLists
    .flatMap((list) => list.cards)
    .filter((task) => {
      const deadline = new Date(task.deadline);
      const diff = deadline.getTime() - Date.now();
      return !task.completed && diff > 0 && diff <= 24 * 60 * 60 * 1000;
    }).length;

  const addBoard = () => {
    if (!newBoardName.trim()) {
      Alert.alert("Error", "Board name is required.");
      return;
    }

    const board: Board = {
      id: Date.now().toString(),
      title: newBoardName.trim(),
      lists: createDefaultLists(),
    };

    setBoards((prev) => [...prev, board]);
    setActiveBoardId(board.id);
    setNewBoardName("");
    setScreen("board");
  };

  const addList = () => {
    if (!newListName.trim()) {
      Alert.alert("Error", "List name is required.");
      return;
    }

    updateBoardLists([
      ...activeBoard.lists,
      { id: Date.now().toString(), title: newListName.trim(), cards: [] },
    ]);
    setNewListName("");
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 80}
    >
      <GestureHandlerRootView style={styles.container}>
        <View style={styles.header}>
        <Text style={styles.title}>Task Manager</Text>
        <Text style={styles.subtitle}>{activeBoard.title}</Text>
        <View style={styles.headerActions}>
          <TouchableOpacity style={styles.testButton} onPress={sendTestNotification}>
            <Text style={styles.testButtonText}>Test Notification</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.heroRow}>
          <View style={styles.heroCard}>
            <Text style={styles.heroLabel}>Boards</Text>
            <Text style={styles.heroValue}>{boards.length}</Text>
          </View>
          <View style={styles.heroCard}>
            <Text style={styles.heroLabel}>Total Tasks</Text>
            <Text style={styles.heroValue}>{totalTasks}</Text>
          </View>
          <View style={styles.heroCard}>
            <Text style={styles.heroLabel}>Due Soon</Text>
            <Text style={styles.heroValue}>{dueSoonCount}</Text>
            <Text style={styles.heroSubtitle}>{overdueCount} overdue</Text>
          </View>
        </View>
      </View>

      <View style={styles.tabRow}>
        {(["board", "add", "list"] as const).map((mode) => (
          <TouchableOpacity
            key={mode}
            style={[
              styles.tabButton,
              screen === mode && styles.tabButtonActive,
            ]}
            onPress={() => setScreen(mode)}
          >
            <Text
              style={
                screen === mode ? styles.tabTextActive : styles.tabText
              }
            >
              {mode === "board"
                ? "Board"
                : mode === "add"
                ? "Add Task"
                : "List View"}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.selectorRow}>
        <Text style={styles.selectorLabel}>Board:</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {boards.map((board) => (
            <TouchableOpacity
              key={board.id}
              style={[
                styles.selectorButton,
                board.id === activeBoard.id && styles.selectorButtonActive,
              ]}
              onPress={() => setActiveBoardId(board.id)}
            >
              <Text
                style={
                  board.id === activeBoard.id
                    ? styles.selectorTextActive
                    : styles.selectorText
                }
              >
                {board.title}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      <View style={styles.addBoardRow}>
        <TextInput
          style={styles.input}
          placeholder="New board name"
          value={newBoardName}
          onChangeText={setNewBoardName}
        />
        <Button title="Add Board" onPress={addBoard} />
      </View>

      {screen === "board" && (
        <View style={styles.boardView}>
          <View style={styles.addBoardRow}>
            <TextInput
              style={styles.input}
              placeholder="New list name"
              value={newListName}
              onChangeText={setNewListName}
            />
            <Button title="Add List" onPress={addList} />
          </View>

          <ScrollView
            horizontal
            style={styles.board}
            contentContainerStyle={styles.boardContent}
            showsHorizontalScrollIndicator={false}
          >
            {activeBoardLists.map((list) => (
              <View
                key={list.id}
                ref={(ref) => {
                  listRefs.current[list.id] = ref;
                }}
                onLayout={measureDropZones}
                style={
                  activeDropListId === list.id
                    ? [styles.column, styles.dropHighlight]
                    : styles.column
                }
              >
                <Text style={styles.columnTitle}>{list.title}</Text>
                <Text style={styles.listCount}>{list.cards.length} cards</Text>

                <View style={styles.columnBody}>
                  {list.cards.map((card) => (
                    <PanGestureHandler
                      key={card.id}
                      minDist={20}
                      shouldCancelWhenOutside={false}
                      onGestureEvent={({ nativeEvent }) => {
                        if (draggingTask?.id === card.id) {
                          handleDragMove(nativeEvent.absoluteX, nativeEvent.absoluteY);
                        }
                      }}
                      onHandlerStateChange={({ nativeEvent }) => {
                        if (nativeEvent.state === State.BEGAN) {
                          startDrag(card, list.id, nativeEvent.absoluteX, nativeEvent.absoluteY);
                        }

                        if (
                          nativeEvent.state === State.END ||
                          nativeEvent.state === State.CANCELLED ||
                          nativeEvent.state === State.FAILED
                        ) {
                          handleDragEnd();
                        }
                      }}
                    >
                      <View
                        style={[
                          styles.card,
                          { opacity: draggingTask?.id === card.id ? 0.4 : 1 },
                        ]}
                      >
                        <TaskCard
                          task={card}
                          moveToDone={moveToDone}
                          addTaskLog={addTaskLog}
                        />
                      </View>
                    </PanGestureHandler>
                  ))}
                </View>
              </View>
            ))}
          </ScrollView>

          {draggingTask && (
            <View
              style={[
                styles.dragPreview,
                {
                  left: dragPosition.x - 160,
                  top: dragPosition.y - 48,
                },
              ]}
            >
              <Text style={styles.previewTitle}>{draggingTask.title}</Text>
              <Text style={styles.previewSubtitle}>{draggingTask.assignedTo || "Unassigned"}</Text>
            </View>
          )}
        </View>
      )}

      {screen === "add" && <AddTaskScreen addTask={addTask} />}

      {screen === "list" && (
        <ListViewScreen lists={activeBoardLists} moveToDone={moveToDone} addTaskLog={addTaskLog} />
      )}
    </GestureHandlerRootView>
    </KeyboardAvoidingView>
  );
}

function AddTaskScreen({ addTask }: { addTask: (task: NewTaskInput) => Promise<void> }) {
  const formatDate = (value: Date) => {
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${value.getFullYear()}-${month}-${day}`;
  };

  const [title, setTitle] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [requiredTime, setRequiredTime] = useState("");
  const [deadlineDate, setDeadlineDate] = useState(formatDate(new Date()));
  const [deadlineTime, setDeadlineTime] = useState("18:00");
  const [priority, setPriority] = useState("Medium");

  const applyPreset = (date: Date, time: string) => {
    setDeadlineDate(formatDate(date));
    setDeadlineTime(time);
  };

  const submit = () => {
    const deadline = `${deadlineDate.trim()} ${deadlineTime.trim()}`;
    if (!title || !deadlineDate || !deadlineTime) {
      Alert.alert("Error", "Task title and deadline are required.");
      return;
    }

    const parsed = new Date(deadline);
    if (isNaN(parsed.getTime())) {
      Alert.alert("Error", "Please enter a valid deadline in YYYY-MM-DD and HH:MM format.");
      return;
    }

    addTask({
      title,
      assignedTo,
      requiredTime,
      deadline,
      priority,
    });

    setTitle("");
    setAssignedTo("");
    setRequiredTime("");
    setDeadlineDate(formatDate(new Date()));
    setDeadlineTime("18:00");
    setPriority("Medium");

    Alert.alert("Success", "Task added.");
  };

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const nextMonday = new Date();
  nextMonday.setDate(nextMonday.getDate() + ((8 - nextMonday.getDay()) % 7 || 7));

  return (
    <ScrollView style={styles.form} contentContainerStyle={styles.formContent} keyboardShouldPersistTaps="handled">
      <TextInput
        style={styles.input}
        placeholder="Task title"
        value={title}
        onChangeText={setTitle}
      />

      <TextInput
        style={styles.input}
        placeholder="Assign user"
        value={assignedTo}
        onChangeText={setAssignedTo}
      />

      <TextInput
        style={styles.input}
        placeholder="Required time, e.g. 3 hours"
        value={requiredTime}
        onChangeText={setRequiredTime}
      />

      <View style={styles.deadlineRow}>
        <TextInput
          style={[styles.input, styles.deadlineInput]}
          placeholder="YYYY-MM-DD"
          value={deadlineDate}
          onChangeText={setDeadlineDate}
        />
        <TextInput
          style={[styles.input, styles.deadlineInput]}
          placeholder="HH:MM"
          value={deadlineTime}
          onChangeText={setDeadlineTime}
        />
      </View>

      <View style={styles.presetRow}>
        <TouchableOpacity style={styles.presetButton} onPress={() => applyPreset(new Date(), "18:00")}> 
          <Text style={styles.presetText}>Today 18:00</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.presetButton} onPress={() => applyPreset(tomorrow, "18:00")}> 
          <Text style={styles.presetText}>Tomorrow 18:00</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.presetRow}>
        <TouchableOpacity style={styles.presetButton} onPress={() => applyPreset(tomorrow, "10:00")}> 
          <Text style={styles.presetText}>Tomorrow 10:00</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.presetButton} onPress={() => applyPreset(nextMonday, "09:00")}> 
          <Text style={styles.presetText}>Mon 09:00</Text>
        </TouchableOpacity>
      </View>

      <TextInput
        style={styles.input}
        placeholder="Priority: Low / Medium / High"
        value={priority}
        onChangeText={setPriority}
      />

      <Button title="Add Task" onPress={submit} />
    </ScrollView>
  );
}

function ListViewScreen({ lists, moveToDone, addTaskLog }: { lists: TaskList[]; moveToDone: (cardId: string) => void; addTaskLog: (cardId: string) => void }) {
  const allTasks = lists
    .flatMap((list) => list.cards)
    .sort((a, b) => new Date(a.deadline).getTime() - new Date(b.deadline).getTime());

  return (
    <ScrollView style={styles.listView} contentContainerStyle={styles.listContent} keyboardShouldPersistTaps="handled">
      {allTasks.map((task) => (
        <TaskCard key={task.id} task={task} moveToDone={moveToDone} addTaskLog={addTaskLog} />
      ))}
    </ScrollView>
  );
}

function TaskCard({
  task,
  moveToDone,
  addTaskLog,
}: {
  task: Task;
  moveToDone?: (cardId: string) => void;
  addTaskLog?: (cardId: string) => void;
}) {
  const borderColor = getCardColor(task);
  const getPriorityColor = (p: string) => {
    if (!p) return "#999";
    const up = p.toLowerCase();
    if (up.includes("high")) return "#c62828";
    if (up.includes("medium")) return "#ef6c00";
    if (up.includes("low")) return "#2e7d32";
    return "#607d8b";
  };

  const textColor = getCardTextColor(task);

  return (
    <View style={[styles.card, { backgroundColor: getCardColor(task), borderLeftColor: borderColor }]}> 
      <View style={[styles.priorityBadge, { backgroundColor: getPriorityColor(task.priority) }]}> 
        <Text style={styles.priorityBadgeText}>{task.priority}</Text>
      </View>

      <Text style={[styles.cardTitle, { color: textColor }]}>{task.title}</Text>
      <Text style={[styles.cardText, { color: textColor }]}>Assigned to: {task.assignedTo || "Unassigned"}</Text>
      <Text style={[styles.cardText, { color: textColor }]}>Required time: {task.requiredTime}</Text>
      <Text style={[styles.cardText, { color: textColor }]}>Deadline: {task.deadline}</Text>

      <Text style={[styles.logsTitle, { color: textColor }]}>Activity Logs</Text>
      {task.logs.map((log, index) => (
        <Text key={index} style={[styles.log, { color: textColor }]}>• {log}</Text>
      ))}

      {(moveToDone || addTaskLog) && (
        <View style={styles.cardActions}>
          {moveToDone && !task.completed && (
            <Button title="Mark as Complete" onPress={() => moveToDone(task.id)} />
          )}
          {addTaskLog && (
            <Button title="Add Note" onPress={() => addTaskLog(task.id)} />
          )}
        </View>
      )}
    </View>
  );
}

function getCardColor(task: Task) {
  if (task.completed) return "#8BC34A";

  const now = new Date();
  const deadline = new Date(task.deadline);
  const diffHours = (deadline.getTime() - now.getTime()) / (1000 * 60 * 60);

  if (diffHours <= 0) return "#E57373";
  if (diffHours <= 24) return "#FFB74D";
  if (diffHours <= 72) return "#FFF176";

  return "#FFFFFF";
}

function getCardTextColor(task: Task) {
  const bg = getCardColor(task);
  if (bg === "#E57373" || bg === "#8BC34A") return "#fff";
  return "#111";
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f2f2f2",
    paddingTop: 36,
  },
  header: {
    paddingHorizontal: 16,
    marginBottom: 12,
    backgroundColor: "#1f8ef1",
    paddingTop: 18,
    paddingBottom: 18,
    borderBottomLeftRadius: 18,
    borderBottomRightRadius: 18,
  },
  title: {
    fontSize: 28,
    fontWeight: "bold",
    color: "#fff",
  },
  subtitle: {
    marginTop: 4,
    color: "rgba(255,255,255,0.9)",
  },
  headerActions: {
    marginTop: 8,
    flexDirection: "row",
    justifyContent: "flex-end",
  },
  testButton: {
    backgroundColor: "rgba(255,255,255,0.16)",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
  },
  testButtonText: {
    color: "#fff",
    fontWeight: "600",
  },
  heroRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 18,
  },
  heroCard: {
    flex: 1,
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 14,
    marginRight: 10,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
  },
  heroCardLast: {
    marginRight: 0,
  },
  heroLabel: {
    fontSize: 12,
    color: "#5c6b86",
  },
  heroValue: {
    fontSize: 22,
    fontWeight: "700",
    marginTop: 8,
    color: "#111",
  },
  heroSubtitle: {
    marginTop: 6,
    color: "#5c6b86",
    fontSize: 12,
  },
  tabRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginHorizontal: 16,
    marginBottom: 12,
    backgroundColor: "#ffffff",
    borderRadius: 18,
    padding: 8,
    shadowColor: "#2a4a7a",
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
  },
  tabButton: {
    flex: 1,
    marginHorizontal: 4,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: "transparent",
    alignItems: "center",
  },
  tabButtonActive: {
    backgroundColor: "#2f95dc",
  },
  tabText: {
    color: "#555",
    fontWeight: "600",
  },
  tabTextActive: {
    color: "#fff",
    fontWeight: "700",
  },
  selectorRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  selectorLabel: {
    marginRight: 10,
    fontWeight: "600",
    color: "#333",
  },
  selectorButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: "#ffffff",
    marginRight: 10,
  },
  selectorButtonActive: {
    backgroundColor: "#2f95dc",
  },
  selectorText: {
    color: "#333",
  },
  selectorTextActive: {
    color: "#fff",
  },
  addBoardRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    marginBottom: 12,
    justifyContent: "space-between",
  },
  boardView: {
    flex: 1,
  },
  board: {
    flex: 1,
    paddingHorizontal: 16,
  },
  boardContent: {
    paddingVertical: 12,
  },
  column: {
    width: 260,
    minHeight: 240,
    backgroundColor: "#f7f7f7",
    marginRight: 16,
    padding: 16,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#ececec",
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 2 },
  },
  dropHighlight: {
    borderColor: "#34c759",
    backgroundColor: "#edf9f0",
  },
  columnBody: {
    marginTop: 12,
  },
  columnTitle: {
    fontSize: 20,
    fontWeight: "bold",
    marginBottom: 10,
  },
  listCount: {
    marginBottom: 8,
    color: "#444",
  },
  card: {
    padding: 16,
    borderRadius: 16,
    marginBottom: 12,
    backgroundColor: "#fff",
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    borderLeftWidth: 6,
  },
  priorityBadge: {
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    marginBottom: 8,
  },
  priorityBadgeText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 12,
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: "bold",
    marginBottom: 6,
  },
  cardActions: {
    marginTop: 10,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  dragPreview: {
    position: "absolute",
    width: 320,
    padding: 14,
    backgroundColor: "rgba(255,255,255,0.96)",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.08)",
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 10 },
    zIndex: 100,
  },
  previewTitle: {
    fontSize: 16,
    fontWeight: "700",
    marginBottom: 4,
  },
  previewSubtitle: {
    color: "#666",
    fontSize: 13,
  },
  form: {
    padding: 16,
    backgroundColor: "#f6f9ff",
    borderRadius: 24,
    marginHorizontal: 16,
    marginBottom: 16,
  },
  formContent: {
    paddingBottom: 120,
  },
  deadlineRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  deadlineInput: {
    flex: 1,
    marginRight: 8,
  },
  presetRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  presetButton: {
    flex: 1,
    backgroundColor: "#2f95dc",
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: "center",
    marginRight: 8,
  },
  presetButtonLast: {
    marginRight: 0,
  },
  presetText: {
    color: "#fff",
    fontWeight: "600",
  },
  input: {
    borderWidth: 1,
    borderColor: "#aaa",
    padding: 12,
    borderRadius: 8,
    backgroundColor: "#fff",
    marginBottom: 10,
  },
  listView: {
    flex: 1,
    padding: 15,
  },
  listContent: {
    paddingBottom: 120,
  },
  cardText: {
    fontSize: 14,
    marginBottom: 2,
  },
  logsTitle: {
    marginTop: 8,
    fontWeight: "bold",
  },
  log: {
    fontSize: 12,
  },
});