import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Button,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
} from "react-native";
import * as Notifications from "expo-notifications";
import DraggableFlatList from "react-native-draggable-flatlist";
import { NavigationContainer } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";

const Tab = createBottomTabNavigator();

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

const initialLists = [
  {
    id: "todo",
    title: "To Do",
    cards: [],
  },
  {
    id: "doing",
    title: "Doing",
    cards: [],
  },
  {
    id: "done",
    title: "Done",
    cards: [],
  },
];

export default function App() {
  const [lists, setLists] = useState(initialLists);

  useEffect(() => {
    Notifications.requestPermissionsAsync();
  }, []);

  const addTask = async (task) => {
    const newTask = {
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

    setLists((prev) =>
      prev.map((list) =>
        list.id === "todo"
          ? { ...list, cards: [...list.cards, newTask] }
          : list
      )
    );

    await scheduleReminder(newTask);
  };

  const scheduleReminder = async (task) => {
    const deadlineDate = new Date(task.deadline);

    if (isNaN(deadlineDate.getTime())) return;

    const reminderTime = new Date(deadlineDate.getTime() - 60 * 60 * 1000);

    if (reminderTime > new Date()) {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: "Task Reminder",
          body: `${task.title} is due soon!`,
        },
        trigger: reminderTime,
      });
    }
  };

  const moveToDone = (cardId) => {
    setLists((prev) => {
      let cardToMove = null;

      const updatedLists = prev.map((list) => {
        const remainingCards = list.cards.filter((card) => {
          if (card.id === cardId) {
            cardToMove = {
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

      return updatedLists.map((list) =>
        list.id === "done" && cardToMove
          ? { ...list, cards: [...list.cards, cardToMove] }
          : list
      );
    });
  };

  return (
    <NavigationContainer>
      <Tab.Navigator>
        <Tab.Screen name="Board">
          {() => (
            <BoardScreen
              lists={lists}
              setLists={setLists}
              moveToDone={moveToDone}
            />
          )}
        </Tab.Screen>

        <Tab.Screen name="Add Task">
          {() => <AddTaskScreen addTask={addTask} />}
        </Tab.Screen>

        <Tab.Screen name="List View">
          {() => <ListViewScreen lists={lists} moveToDone={moveToDone} />}
        </Tab.Screen>
      </Tab.Navigator>
    </NavigationContainer>
  );
}

function BoardScreen({ lists, setLists, moveToDone }) {
  const updateCards = (listId, cards) => {
    setLists((prev) =>
      prev.map((list) => (list.id === listId ? { ...list, cards } : list))
    );
  };

  return (
    <ScrollView horizontal style={styles.board}>
      {lists.map((list) => (
        <View key={list.id} style={styles.column}>
          <Text style={styles.columnTitle}>{list.title}</Text>

          <DraggableFlatList
            data={list.cards}
            keyExtractor={(item) => item.id}
            onDragEnd={({ data }) => updateCards(list.id, data)}
            renderItem={({ item, drag }) => (
              <TouchableOpacity onLongPress={drag}>
                <TaskCard task={item} moveToDone={moveToDone} />
              </TouchableOpacity>
            )}
          />
        </View>
      ))}
    </ScrollView>
  );
}

function AddTaskScreen({ addTask }) {
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

function ListViewScreen({ lists, moveToDone }) {
  const allTasks = lists
    .flatMap((list) => list.cards)
    .sort((a, b) => new Date(a.deadline) - new Date(b.deadline));

  return (
    <ScrollView style={styles.listView}>
      {allTasks.map((task) => (
        <TaskCard key={task.id} task={task} moveToDone={moveToDone} />
      ))}
    </ScrollView>
  );
}

function TaskCard({ task, moveToDone }) {
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

      {!task.completed && (
        <Button title="Mark as Complete" onPress={() => moveToDone(task.id)} />
      )}
    </View>
  );
}

function getCardColor(task) {
  if (task.completed) return "#8BC34A";

  const now = new Date();
  const deadline = new Date(task.deadline);
  const diffHours = (deadline - now) / (1000 * 60 * 60);

  if (diffHours <= 0) return "#E57373";
  if (diffHours <= 24) return "#FFB74D";
  if (diffHours <= 72) return "#FFF176";

  return "#FFFFFF";
}

const styles = StyleSheet.create({
  board: {
    flex: 1,
    backgroundColor: "#f2f2f2",
    padding: 10,
  },
  column: {
    width: 280,
    backgroundColor: "#e0e0e0",
    marginRight: 12,
    padding: 10,
    borderRadius: 10,
  },
  columnTitle: {
    fontSize: 20,
    fontWeight: "bold",
    marginBottom: 10,
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
  form: {
    flex: 1,
    padding: 20,
    gap: 12,
  },
  input: {
    borderWidth: 1,
    borderColor: "#aaa",
    padding: 12,
    borderRadius: 8,
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