export class AuthData {
  static readonly admin = {
    email: 'admin@demo.test',
    password: 'admin123'
  };

  static readonly user = {
    email: 'user@demo.test',
    password: 'user123'
  };

  static readonly expected = {
    loginSuccess: 'Welcome back!',
    invalidCredentials: 'Invalid email or password'
  };
}