/*
TasksLocators.ts — generated from probe of http://localhost:3000/tasks
Elements observed:
- INPUT with label "New task title"
- BUTTON with name "Add"
- A with name "← Sign out"
*/

export class TasksLocators {
  static readonly taskTitleInput = () => page.getByLabel('New task title');
  static readonly addTaskButton = () => page.getByRole('button', { name: 'Add' });
  static readonly signOutLink = () => page.getByRole('link', { name: '← Sign out' });
}