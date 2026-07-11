export class AuthData {
  static readonly valid = {
    email: 'admin@demo.test',
    password: 'admin123',
  };

  static readonly invalid = {
    email: 'invalid@example.com',
    password: 'wrong',
  };

  static readonly expectedErrors = {
    invalidCredentials: 'Invalid email or password',
  };
}