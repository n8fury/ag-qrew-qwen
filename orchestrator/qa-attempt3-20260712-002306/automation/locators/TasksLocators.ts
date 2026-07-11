// TasksLocators.ts — built from probe of http://localhost:3000/tasks (authenticated)
// Elements observed: New task title input (placeholder), Add button, Sign out link

export const TasksLocators = {
  newTaskInput: (page) => page.getByPlaceholder("New task title"),
  addTaskButton: (page) => page.getByRole("button", { name: "Add" }),
  signOutLink: (page) => page.getByText("← Sign out")
};