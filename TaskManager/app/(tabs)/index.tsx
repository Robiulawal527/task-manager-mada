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
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <GestureHandlerRootView style={styles.container}>
        <View style={styles.header}>
          <View style={styles.headerTop}>
            <View>
              <Text style={styles.title}>Task Manager</Text>
              <Text style={styles.subtitle}>{activeBoard.title}</Text>
            </View>
            <TouchableOpacity style={styles.testButton} onPress={sendTestNotification}>
              <Text style={styles.testButtonText}>Ping</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.heroRow}>
            <View style={styles.heroCard}>
              <Text style={styles.heroValue}>{boards.length}</Text>
              <Text style={styles.heroLabel}>Boards</Text>
            </View>
            <View style={styles.heroCard}>
              <Text style={styles.heroValue}>{totalTasks}</Text>
              <Text style={styles.heroLabel}>Total Tasks</Text>
            </View>
            <View style={styles.heroCard}>
              <Text style={styles.heroValue}>{dueSoonCount}</Text>
              <Text style={styles.heroLabel}>Due Soon</Text>
              {overdueCount > 0 && <Text style={styles.heroSubtitle}>{overdueCount} overdue</Text>}
            </View>
          </View>
        </View>

        <View style={styles.tabContainer}>
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
                  {mode === "board" ? "Board" : mode === "add" ? "Add Task" : "List"}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.selectorRow}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.selectorScroll}>
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

        {screen === "board" && (
          <View style={styles.addInlineRow}>
            <TextInput
              style={styles.addInlineInput}
              placeholder="New board name..."
              placeholderTextColor="#94a3b8"
              value={newBoardName}
              onChangeText={setNewBoardName}
            />
            <TouchableOpacity style={styles.addInlineBtn} onPress={addBoard}>
              <Text style={styles.addInlineBtnText}>+ Board</Text>
            </TouchableOpacity>
          </View>
        )}

        {screen === "board" && (
          <View style={styles.boardView}>
            <View style={styles.addInlineRow}>
              <TextInput
                style={styles.addInlineInput}
                placeholder="New list name..."
                placeholderTextColor="#94a3b8"
                value={newListName}
                onChangeText={setNewListName}
              />
              <TouchableOpacity style={styles.addInlineBtn} onPress={addList}>
                <Text style={styles.addInlineBtnText}>+ List</Text>
              </TouchableOpacity>
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
                  <View style={styles.columnHeader}>
                    <Text style={styles.columnTitle}>{list.title}</Text>
                    <View style={styles.listCountBadge}>
                      <Text style={styles.listCountText}>{list.cards.length}</Text>
                    </View>
                  </View>

                  <View style={styles.columnBody}>
                    {list.cards.map((card) => (
                      <PanGestureHandler
                        key={card.id}
                        minDist={10}
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
                            styles.cardContainer,
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
                    left: dragPosition.x - 140,
                    top: dragPosition.y - 40,
                  },
                ]}
              >
                <Text style={styles.previewTitle} numberOfLines={1}>{draggingTask.title}</Text>
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
      Alert.alert("Hold on", "Task title and deadline are required.");
      return;
    }

    const parsed = new Date(deadline);
    if (isNaN(parsed.getTime())) {
      Alert.alert("Oops", "Please enter a valid deadline in YYYY-MM-DD and HH:MM format.");
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

    Alert.alert("Awesome", "Task added successfully!");
  };

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const nextMonday = new Date();
  nextMonday.setDate(nextMonday.getDate() + ((8 - nextMonday.getDay()) % 7 || 7));

  return (
    <ScrollView style={styles.formContainer} contentContainerStyle={styles.formContent} keyboardShouldPersistTaps="handled">
      <Text style={styles.formSectionTitle}>Create New Task</Text>

      <View style={styles.inputGroup}>
        <Text style={styles.inputLabel}>Task Title</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. Design homepage..."
          placeholderTextColor="#9ca3af"
          value={title}
          onChangeText={setTitle}
        />
      </View>

      <View style={styles.inputGroup}>
        <Text style={styles.inputLabel}>Assign User</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. Alex"
          placeholderTextColor="#9ca3af"
          value={assignedTo}
          onChangeText={setAssignedTo}
        />
      </View>

      <View style={styles.inputGroup}>
        <Text style={styles.inputLabel}>Estimated Time</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. 3 hours"
          placeholderTextColor="#9ca3af"
          value={requiredTime}
          onChangeText={setRequiredTime}
        />
      </View>

      <View style={styles.inputGroup}>
        <Text style={styles.inputLabel}>Deadline</Text>
        <View style={styles.deadlineRow}>
          <TextInput
            style={[styles.input, styles.deadlineInput]}
            placeholder="YYYY-MM-DD"
            placeholderTextColor="#9ca3af"
            value={deadlineDate}
            onChangeText={setDeadlineDate}
          />
          <TextInput
            style={[styles.input, styles.deadlineInput]}
            placeholder="HH:MM"
            placeholderTextColor="#9ca3af"
            value={deadlineTime}
            onChangeText={setDeadlineTime}
          />
        </View>
        <View style={styles.presetRow}>
          <TouchableOpacity style={styles.presetBtn} onPress={() => applyPreset(new Date(), "18:00")}> 
            <Text style={styles.presetBtnText}>Today 6 PM</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.presetBtn} onPress={() => applyPreset(tomorrow, "18:00")}> 
            <Text style={styles.presetBtnText}>Tmrw 6 PM</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.presetBtn} onPress={() => applyPreset(nextMonday, "09:00")}> 
            <Text style={styles.presetBtnText}>Mon 9 AM</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.inputGroup}>
        <Text style={styles.inputLabel}>Priority</Text>
        <View style={styles.prioritySelector}>
          {["Low", "Medium", "High"].map((p) => {
            const isActive = priority.toLowerCase() === p.toLowerCase();
            return (
              <TouchableOpacity
                key={p}
                style={[
                  styles.priorityBtn,
                  isActive && styles.priorityBtnActive,
                  isActive && p === "High" && { backgroundColor: "#ffebee", borderColor: "#ef5350" },
                  isActive && p === "Medium" && { backgroundColor: "#fff3e0", borderColor: "#ffa726" },
                  isActive && p === "Low" && { backgroundColor: "#e8f5e9", borderColor: "#66bb6a" },
                ]}
                onPress={() => setPriority(p)}
              >
                <Text
                  style={[
                    styles.priorityBtnText,
                    isActive && styles.priorityBtnTextActive,
                    isActive && p === "High" && { color: "#d32f2f" },
                    isActive && p === "Medium" && { color: "#f57c00" },
                    isActive && p === "Low" && { color: "#388e3c" },
                  ]}
                >
                  {p}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      <TouchableOpacity style={styles.submitBtn} onPress={submit}>
        <Text style={styles.submitBtnText}>Save Task</Text>
      </TouchableOpacity>
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
        <View key={task.id} style={styles.listCardWrapper}>
          <TaskCard task={task} moveToDone={moveToDone} addTaskLog={addTaskLog} />
        </View>
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
  const colors = getCardTheme(task);

  const getPriorityColor = (p: string) => {
    if (!p) return { bg: "#f5f5f5", text: "#666666" };
    const up = p.toLowerCase();
    if (up.includes("high")) return { bg: "#ffebee", text: "#d32f2f" };
    if (up.includes("medium")) return { bg: "#fff3e0", text: "#e65100" };
    if (up.includes("low")) return { bg: "#e8f5e9", text: "#2e7d32" };
    return { bg: "#f5f5f5", text: "#666666" };
  };
  
  const priorityTheme = getPriorityColor(task.priority);

  return (
    <View style={[styles.card, { backgroundColor: colors.bg, borderColor: colors.border }]}> 
      <View style={styles.cardHeader}>
        <View style={[styles.priorityBadge, { backgroundColor: priorityTheme.bg }]}> 
          <Text style={[styles.priorityBadgeText, { color: priorityTheme.text }]}>{task.priority || "None"}</Text>
        </View>
        {task.completed && (
          <View style={styles.completedBadge}>
            <Text style={styles.completedBadgeText}>DONE</Text>
          </View>
        )}
      </View>

      <Text style={[styles.cardTitle, { color: colors.title }]}>{task.title}</Text>
      
      <View style={styles.cardDetails}>
        <Text style={[styles.cardText, { color: colors.text }]} numberOfLines={1}>Assignee: {task.assignedTo || "Unassigned"}</Text>
        <Text style={[styles.cardText, { color: colors.text }]}>Time: {task.requiredTime || "N/A"}</Text>
        <Text style={[styles.cardText, { color: colors.text }]}>Due: {task.deadline}</Text>
      </View>

      {task.logs && task.logs.length > 0 && (
        <View style={styles.logsContainer}>
          <Text style={[styles.logsTitle, { color: colors.text }]}>Activity</Text>
          {task.logs.slice(-2).map((log, index) => (
            <Text key={index} style={[styles.log, { color: colors.text }]} numberOfLines={1}>• {log}</Text>
          ))}
        </View>
      )}

      {(moveToDone || addTaskLog) && (
        <View style={styles.cardActions}>
          {moveToDone && !task.completed && (
            <TouchableOpacity style={[styles.actionBtn, styles.completeBtn]} onPress={() => moveToDone(task.id)}>
              <Text style={styles.completeBtnText}>Complete</Text>
            </TouchableOpacity>
          )}
          {addTaskLog && (
            <TouchableOpacity style={[styles.actionBtn, styles.noteBtn]} onPress={() => addTaskLog(task.id)}>
              <Text style={styles.noteBtnText}>Add Note</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
}

function getCardTheme(task: Task) {
  if (task.completed) {
    return { bg: "#ffffff", border: "#4caf50", title: "#000000", text: "#666666" };
  }

  const now = new Date();
  const deadline = new Date(task.deadline);
  const diffHours = (deadline.getTime() - now.getTime()) / (1000 * 60 * 60);

  if (diffHours <= 0) {
    return { bg: "#ffffff", border: "#f44336", title: "#000000", text: "#666666" };
  }
  if (diffHours <= 24) {
    return { bg: "#ffffff", border: "#ff9800", title: "#000000", text: "#666666" };
  }
  
  return { bg: "#ffffff", border: "#eaeaea", title: "#000000", text: "#666666" };
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#ffffff",
    paddingTop: Platform.OS === 'android' ? 40 : 48,
  },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 24,
    backgroundColor: "#ffffff",
    borderBottomWidth: 1,
    borderBottomColor: "#eaeaea",
  },
  headerTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    color: "#000000",
    letterSpacing: -0.5,
  },
  subtitle: {
    marginTop: 2,
    color: "#666666",
    fontSize: 14,
    fontWeight: "400",
  },
  testButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#eaeaea",
  },
  testButtonText: {
    color: "#000000",
    fontWeight: "500",
    fontSize: 12,
  },
  heroRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 24,
  },
  heroCard: {
    flex: 1,
    padding: 12,
    marginHorizontal: 4,
    borderWidth: 1,
    borderColor: "#eaeaea",
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroLabel: {
    fontSize: 11,
    color: "#666666",
    fontWeight: "500",
    marginTop: 4,
  },
  heroValue: {
    fontSize: 20,
    fontWeight: "700",
    color: "#000000",
  },
  heroSubtitle: {
    marginTop: 4,
    color: "#d32f2f",
    fontSize: 10,
    fontWeight: "600",
  },
  tabContainer: {
    paddingHorizontal: 20,
    marginTop: 16,
  },
  tabRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#eaeaea",
  },
  tabButton: {
    flex: 1,
    paddingVertical: 12,
    alignItems: "center",
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  tabButtonActive: {
    borderBottomColor: "#000000",
  },
  tabText: {
    color: "#888888",
    fontWeight: "500",
    fontSize: 14,
  },
  tabTextActive: {
    color: "#000000",
    fontWeight: "600",
    fontSize: 14,
  },
  selectorRow: {
    marginTop: 16,
    paddingBottom: 16,
  },
  selectorScroll: {
    paddingHorizontal: 20,
  },
  selectorButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#eaeaea",
    marginRight: 10,
  },
  selectorButtonActive: {
    backgroundColor: "#000000",
    borderColor: "#000000",
  },
  selectorText: {
    color: "#666666",
    fontWeight: "400",
    fontSize: 13,
  },
  selectorTextActive: {
    color: "#ffffff",
    fontWeight: "500",
    fontSize: 13,
  },
  addInlineRow: {
    flexDirection: "row",
    paddingHorizontal: 20,
    marginBottom: 16,
  },
  addInlineInput: {
    flex: 1,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#eaeaea",
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginRight: 10,
    color: "#000000",
    fontSize: 14,
  },
  addInlineBtn: {
    backgroundColor: "#000000",
    justifyContent: "center",
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  addInlineBtnText: {
    color: "#ffffff",
    fontWeight: "500",
    fontSize: 13,
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
    paddingRight: 32,
  },
  column: {
    width: 280,
    backgroundColor: "#fafafa",
    marginRight: 16,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#eaeaea",
  },
  dropHighlight: {
    borderColor: "#000000",
    backgroundColor: "#f5f5f5",
  },
  columnHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  columnTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#000000",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  listCountBadge: {
    backgroundColor: "#eaeaea",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
  },
  listCountText: {
    fontSize: 11,
    fontWeight: "500",
    color: "#333333",
  },
  columnBody: {
    minHeight: 200,
  },
  cardContainer: {
    marginBottom: 12,
  },
  card: {
    padding: 16,
    borderRadius: 8,
    borderWidth: 1,
    backgroundColor: '#ffffff',
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 12,
  },
  priorityBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  priorityBadgeText: {
    fontWeight: "600",
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  completedBadge: {
    backgroundColor: "#e8f5e9",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  completedBadgeText: {
    color: "#2e7d32",
    fontWeight: "600",
    fontSize: 10,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: "600",
    marginBottom: 12,
    lineHeight: 20,
    color: "#000000",
  },
  cardDetails: {
    gap: 4,
  },
  cardText: {
    fontSize: 12,
    fontWeight: "400",
    color: "#666666",
  },
  logsContainer: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "#eaeaea",
  },
  logsTitle: {
    fontSize: 11,
    fontWeight: "600",
    marginBottom: 4,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    color: "#333333",
  },
  log: {
    fontSize: 11,
    marginTop: 2,
    color: "#666666",
  },
  cardActions: {
    marginTop: 16,
    flexDirection: "row",
    gap: 8,
  },
  actionBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 6,
    alignItems: "center",
    borderWidth: 1,
  },
  completeBtn: {
    backgroundColor: "#000000",
    borderColor: "#000000",
  },
  completeBtnText: {
    color: "#ffffff",
    fontWeight: "500",
    fontSize: 12,
  },
  noteBtn: {
    backgroundColor: "transparent",
    borderColor: "#eaeaea",
  },
  noteBtnText: {
    color: "#000000",
    fontWeight: "500",
    fontSize: 12,
  },
  dragPreview: {
    position: "absolute",
    width: 280,
    padding: 16,
    backgroundColor: "#ffffff",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#000000",
    shadowColor: "#000000",
    shadowOpacity: 0.1,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    zIndex: 100,
    transform: [{ scale: 1.02 }],
  },
  previewTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: "#000000",
    marginBottom: 4,
  },
  previewSubtitle: {
    color: "#666666",
    fontSize: 12,
  },
  formContainer: {
    flex: 1,
    padding: 20,
  },
  formContent: {
    paddingBottom: 100,
  },
  formSectionTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#000000",
    marginBottom: 20,
  },
  inputGroup: {
    marginBottom: 20,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: "500",
    color: "#666666",
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  input: {
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#eaeaea",
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 8,
    color: "#000000",
    fontSize: 14,
  },
  deadlineRow: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 12,
  },
  deadlineInput: {
    flex: 1,
  },
  presetRow: {
    flexDirection: "row",
    gap: 8,
  },
  presetBtn: {
    flex: 1,
    backgroundColor: "#fafafa",
    borderWidth: 1,
    borderColor: "#eaeaea",
    paddingVertical: 8,
    borderRadius: 6,
    alignItems: "center",
  },
  presetBtnText: {
    color: "#333333",
    fontSize: 11,
    fontWeight: "500",
  },
  prioritySelector: {
    flexDirection: "row",
    gap: 12,
  },
  priorityBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#eaeaea",
    backgroundColor: "#ffffff",
    alignItems: "center",
  },
  priorityBtnActive: {
    backgroundColor: "#fafafa",
    borderColor: "#000000",
  },
  priorityBtnText: {
    color: "#666666",
    fontWeight: "500",
    fontSize: 13,
  },
  priorityBtnTextActive: {
    color: "#000000",
    fontWeight: "600",
  },
  submitBtn: {
    backgroundColor: "#000000",
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 10,
  },
  submitBtnText: {
    color: "#ffffff",
    fontWeight: "600",
    fontSize: 14,
  },
  listView: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  listContent: {
    paddingBottom: 100,
  },
  listCardWrapper: {
    marginBottom: 16,
  }
});