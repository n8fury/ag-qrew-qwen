/*
TasksLocators.ts
- Observed URL: http://localhost:3000/tasks
- Auth required: yes (redirects to / if unauthenticated)
- Elements observed (probe): New task title input (label="New task title"), Add button (name="Add"), Sign out link (name="← Sign out")
*/
export const TasksLocators = {
  newTaskInput: (page: import('playwright').Page) => page.getByRole('textbox', { name: 'New task title' }),
  addTaskButton: (page: import('playwright').Page) => page.getByRole('button', { name: 'Add' }),
  signOutLink: (page: import('playwright').Page) => page.getByRole('link', { name: '← Sign out' }),
};