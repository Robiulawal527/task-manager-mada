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
} from "react-native";
import {
  GestureHandlerRootView,
  PanGestureHandler,
  PanGestureHandlerGestureEvent,
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

  useEffect(() => {
    async function initNotifications() {
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
        await module.requestPermissionsAsync();
      } catch {
        // permission request may fail in Expo Go; ignore gracefully
      }
    }

    initNotifications();
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

    if (fromListId === toListId) {
      updateBoardLists(nextLists);
      return;
    }

    const completedTask =
      toListId === "done" && !movedTask.completed
        ? {
            ...movedTask,
            completed: true,
            logs: [
              ...movedTask.logs,
              `Moved to Done at ${new Date().toLocaleString()}`,
            ],
          }
        : movedTask;

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

    if (isNaN(deadlineDate.getTime())) return;

    const reminderTime = new Date(deadlineDate.getTime() - 60 * 60 * 1000);

    if (reminderTime > new Date() && notificationsRef.current) {
      const secondsUntilTrigger = Math.max(
        Math.floor((reminderTime.getTime() - Date.now()) / 1000),
        1
      );

      await notificationsRef.current.scheduleNotificationAsync({
        content: {
          title: "Task Reminder",
          body: `${task.title} is due soon!`,
        },
        trigger: {
          type: "timeInterval",
          seconds: secondsUntilTrigger,
          repeats: false,
        } as any,
      });
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
    <GestureHandlerRootView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Task Manager</Text>
        <Text style={styles.subtitle}>{activeBoard.title}</Text>
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
                          addTaskLog={(taskId) => {
                            updateBoardLists(
                              activeBoardLists.map((current) => ({
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
                          }}
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
        <ListViewScreen lists={activeBoardLists} moveToDone={moveToDone} />
      )}
    </GestureHandlerRootView>
  );
}

function AddTaskScreen({ addTask }: { addTask: (task: NewTaskInput) => Promise<void> }) {
  const [title, setTitle] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [requiredTime, setRequiredTime] = useState("");
  const [deadline, setDeadline] = useState("");
  const [priority, setPriority] = useState("Medium");

  const submit = () => {
    if (!title || !deadline) {
      Alert.alert("Error", "Task title and deadline are required.");
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
    setDeadline("");
    setPriority("Medium");

    Alert.alert("Success", "Task added.");
  };

  return (
    <View style={styles.form}>
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

      <TextInput
        style={styles.input}
        placeholder="Deadline, e.g. 2026-05-25 18:00"
        value={deadline}
        onChangeText={setDeadline}
      />

      <TextInput
        style={styles.input}
        placeholder="Priority: Low / Medium / High"
        value={priority}
        onChangeText={setPriority}
      />

      <Button title="Add Task" onPress={submit} />
    </View>
  );
}

function ListViewScreen({ lists, moveToDone }: { lists: TaskList[]; moveToDone: (cardId: string) => void }) {
  const allTasks = lists
    .flatMap((list) => list.cards)
    .sort((a, b) => new Date(a.deadline).getTime() - new Date(b.deadline).getTime());

  return (
    <ScrollView style={styles.listView}>
      {allTasks.map((task) => (
        <TaskCard key={task.id} task={task} moveToDone={moveToDone} />
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
  return (
    <View style={[styles.card, { backgroundColor: getCardColor(task) }]}> 
      <Text style={styles.cardTitle}>{task.title}</Text>
      <Text>Assigned to: {task.assignedTo || "Unassigned"}</Text>
      <Text>Required time: {task.requiredTime}</Text>
      <Text>Deadline: {task.deadline}</Text>
      <Text>Priority: {task.priority}</Text>

      <Text style={styles.logsTitle}>Activity Logs</Text>
      {task.logs.map((log, index) => (
        <Text key={index} style={styles.log}>
          • {log}
        </Text>
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f2f2f2",
    paddingTop: 36,
  },
  header: {
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  title: {
    fontSize: 28,
    fontWeight: "bold",
  },
  subtitle: {
    marginTop: 4,
    color: "#666",
  },
  tabRow: {
    flexDirection: "row",
    justifyContent: "space-around",
    marginHorizontal: 12,
    marginBottom: 12,
  },
  tabButton: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: "#ffffff",
  },
  tabButtonActive: {
    backgroundColor: "#2f95dc",
  },
  tabText: {
    color: "#333",
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
    width: 300,
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
    padding: 12,
    borderRadius: 10,
    marginBottom: 10,
    elevation: 3,
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
  logsTitle: {
    marginTop: 8,
    fontWeight: "bold",
  },
  log: {
    fontSize: 12,
  },
});