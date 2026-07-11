export class TasksData {
  static readonly valid = {
    taskTitle: 'Test Task'
  };

  static readonly expected = {
    taskListContains: 'Test Task',
    logoutSuccessMessage: 'You have been signed out.'
  };
}