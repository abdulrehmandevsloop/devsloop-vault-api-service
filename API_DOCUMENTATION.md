# DevsLoop Vault - Backend API Documentation

**Base URL:** `http://localhost:3001/api`  
**API Version:** 1.0  
**Swagger UI:** http://localhost:3001/api/docs

---

## 📋 Table of Contents

1. [Quick Start](#quick-start)
2. [Authentication](#authentication)
3. [API Endpoints](#api-endpoints)
4. [Error Handling](#error-handling)
5. [Data Models](#data-models)
6. [Code Examples](#code-examples)
7. [Testing](#testing)

---

## 🚀 Quick Start

### Base Configuration

```typescript
const API_BASE_URL = 'http://localhost:3001/api';

// Store tokens
localStorage.setItem('accessToken', token);
localStorage.setItem('refreshToken', token);
```

### Authentication Headers

```typescript
const headers = {
  'Content-Type': 'application/json',
  Authorization: `Bearer ${localStorage.getItem('accessToken')}`,
};
```

---

## 🔐 Authentication

### Authentication Flow

```
1. Register/Login → Receive accessToken + refreshToken
2. Use accessToken → Include in Authorization header
3. Token Expires (15min) → Use refreshToken to get new tokens
4. Logout → Invalidates refreshToken
```

### Token Details

- **Access Token:** Expires in 15 minutes
- **Refresh Token:** Expires in 7 days
- **Password Reset Token:** Expires in 1 hour

---

## 📡 API Endpoints

### Authentication Endpoints

---

#### 1. Register User

**`POST /auth/register`**

Register a new user account.

**Request:**

```json
{
  "email": "user@devsloop.com",
  "password": "SecurePassword123!",
  "name": "John Doe",
  "department": "Engineering",
  "role": "EMPLOYEE"
}
```

**Field Requirements:**

- `email` - Required, valid email format
- `password` - Required, min 8 chars, must contain: uppercase, lowercase, number, special char (@$!%\*?&)
- `name` - Required, string
- `department` - Optional, string
- `role` - Optional, `EMPLOYEE` | `TEAM_LEAD` | `ADMIN` (defaults to `EMPLOYEE`)

**Response:** `201 Created`

```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "clx1234567890",
    "email": "user@devsloop.com",
    "name": "John Doe",
    "role": "EMPLOYEE",
    "department": "Engineering",
    "avatarUrl": null,
    "emailVerified": false
  }
}
```

**Errors:**

- `400` - Validation error
- `409` - User already exists

---

#### 2. Login

**`POST /auth/login`**

Authenticate user and receive tokens.

**Rate Limit:** 5 attempts per minute

**Request:**

```json
{
  "email": "user@devsloop.com",
  "password": "SecurePassword123!"
}
```

**Response:** `200 OK`

```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "clx1234567890",
    "email": "user@devsloop.com",
    "name": "John Doe",
    "role": "EMPLOYEE",
    "department": "Engineering",
    "avatarUrl": null,
    "emailVerified": true
  }
}
```

**Errors:**

- `400` - Validation error
- `401` - Invalid credentials
- `429` - Too many login attempts

---

#### 3. Refresh Token

**`POST /auth/refresh`**

Get new access and refresh tokens.

**Request:**

```json
{
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Response:** `200 OK`

```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "clx1234567890",
    "email": "user@devsloop.com",
    "name": "John Doe",
    "role": "EMPLOYEE",
    "department": "Engineering",
    "avatarUrl": null,
    "emailVerified": true
  }
}
```

**Note:** Refresh token rotates on each use. Old token becomes invalid.

**Errors:**

- `400` - Validation error
- `401` - Invalid or expired refresh token

---

#### 4. Logout

**`POST /auth/logout`**

Logout user and invalidate refresh token.

**Headers:**

```
Authorization: Bearer <accessToken>
```

**Response:** `200 OK`

```json
{
  "message": "Logged out successfully"
}
```

**Errors:**

- `401` - Unauthorized

---

#### 5. Get Current User

**`GET /auth/me`**

Get authenticated user's profile.

**Headers:**

```
Authorization: Bearer <accessToken>
```

**Response:** `200 OK`

```json
{
  "id": "clx1234567890",
  "email": "user@devsloop.com",
  "name": "John Doe",
  "role": "EMPLOYEE",
  "department": "Engineering",
  "avatarUrl": "https://api.dicebear.com/7.x/avataaars/svg?seed=john",
  "emailVerified": true,
  "createdAt": "2024-01-15T10:00:00.000Z",
  "updatedAt": "2024-01-20T15:30:00.000Z"
}
```

**Errors:**

- `401` - Unauthorized

---

#### 6. Verify Email

**`POST /auth/verify-email`**

Verify user email with verification code.

**Request:**

```json
{
  "email": "user@devsloop.com",
  "code": "123456"
}
```

**Response:** `200 OK`

```json
{
  "message": "Email verified successfully"
}
```

**Errors:**

- `400` - Invalid or expired verification code

---

#### 7. Resend Verification Code

**`POST /auth/resend-verification`**

Resend email verification code.

**Rate Limit:** 3 attempts per minute

**Request:**

```json
{
  "email": "user@devsloop.com"
}
```

**Response:** `200 OK`

```json
{
  "message": "Verification code sent successfully"
}
```

**Errors:**

- `400` - User not found or email already verified
- `429` - Too many requests

---

#### 8. Forgot Password

**`POST /auth/forgot-password`**

Request password reset link.

**Rate Limit:** 3 attempts per minute

**Request:**

```json
{
  "email": "user@devsloop.com"
}
```

**Response:** `200 OK`

```json
{
  "message": "If an account with that email exists, a password reset link has been sent."
}
```

**Security Note:** Always returns the same message to prevent user enumeration.

**Errors:**

- `400` - Validation error
- `429` - Too many requests

---

#### 9. Reset Password

**`POST /auth/reset-password`**

Reset password using reset token.

**Request:**

```json
{
  "token": "reset-token-from-email",
  "password": "NewSecurePassword123!"
}
```

**Password Requirements:**

- Minimum 8 characters
- At least one uppercase letter (A-Z)
- At least one lowercase letter (a-z)
- At least one number (0-9)
- At least one special character (@$!%\*?&)

**Response:** `200 OK`

```json
{
  "message": "Password has been reset successfully. Please login with your new password."
}
```

**Security Note:** All refresh tokens are invalidated when password is reset.

**Errors:**

- `400` - Invalid or expired reset token, or validation error

---

#### 10. Change Password

**`POST /auth/change-password`**

Change password for authenticated user.

**Headers:**

```
Authorization: Bearer <accessToken>
```

**Request:**

```json
{
  "currentPassword": "OldPassword123!",
  "newPassword": "NewSecurePassword123!"
}
```

**Password Requirements:** Same as reset password

**Response:** `200 OK`

```json
{
  "message": "Password changed successfully. Please login again with your new password."
}
```

**Security Note:** All refresh tokens are invalidated when password is changed.

**Errors:**

- `400` - Validation error or new password same as current
- `401` - Unauthorized or incorrect current password

---

## ⚠️ Error Handling

### Error Response Format

All errors follow this structure:

```json
{
  "statusCode": 400,
  "message": "Validation failed",
  "error": "Bad Request",
  "timestamp": "2024-01-23T12:00:00.000Z",
  "path": "/api/auth/register"
}
```

### HTTP Status Codes

| Code | Meaning               | When It Occurs                          |
| ---- | --------------------- | --------------------------------------- |
| 200  | OK                    | Request successful                      |
| 201  | Created               | Resource created successfully           |
| 400  | Bad Request           | Validation error or invalid input       |
| 401  | Unauthorized          | Invalid or missing authentication token |
| 403  | Forbidden             | Insufficient permissions                |
| 404  | Not Found             | Resource not found                      |
| 409  | Conflict              | Resource already exists                 |
| 429  | Too Many Requests     | Rate limit exceeded                     |
| 500  | Internal Server Error | Server error                            |

### Common Error Messages

**Authentication:**

- `"Invalid credentials"` - Wrong email/password
- `"Invalid or expired refresh token"` - Refresh token invalid
- `"Unauthorized"` - Missing or invalid token

**Validation:**

- `"Email is required"` - Missing email field
- `"Please provide a valid email address"` - Invalid email format
- `"Password must be at least 8 characters long"` - Password too short
- `"Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character"` - Password doesn't meet requirements
- `"User with this email already exists"` - Email already registered
- `"New password must be different from current password"` - Password change validation

**Rate Limiting:**

- `"Too many requests, please try again later"` - Rate limit exceeded

---

## 📊 Data Models

### User Model

```typescript
interface User {
  id: string; // Unique user ID (cuid)
  email: string; // Unique email address
  name: string; // User's full name
  role: 'EMPLOYEE' | 'TEAM_LEAD' | 'ADMIN';
  department?: string; // Optional department
  avatarUrl?: string; // Optional avatar URL
  emailVerified: boolean; // Email verification status
  createdAt: string; // ISO 8601 date string
  updatedAt: string; // ISO 8601 date string
}
```

### Auth Response Model

```typescript
interface AuthResponse {
  accessToken: string; // JWT access token (15 min expiry)
  refreshToken: string; // JWT refresh token (7 days expiry)
  user: User; // User object
}
```

### Password Requirements

All password fields must meet these requirements:

- ✅ Minimum 8 characters
- ✅ At least one uppercase letter (A-Z)
- ✅ At least one lowercase letter (a-z)
- ✅ At least one number (0-9)
- ✅ At least one special character (@$!%\*?&)

---

## 💻 Code Examples

### TypeScript/JavaScript API Client

```typescript
class ApiClient {
  private baseUrl = 'http://localhost:3001/api';

  private async request(endpoint: string, options: RequestInit = {}): Promise<Response> {
    const accessToken = localStorage.getItem('accessToken');

    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(accessToken && { Authorization: `Bearer ${accessToken}` }),
        ...options.headers,
      },
    });

    // Auto-refresh token on 401
    if (response.status === 401 && accessToken) {
      try {
        await this.refreshToken();
        // Retry with new token
        const newToken = localStorage.getItem('accessToken');
        return fetch(`${this.baseUrl}${endpoint}`, {
          ...options,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${newToken}`,
            ...options.headers,
          },
        });
      } catch (error) {
        // Refresh failed, redirect to login
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
        window.location.href = '/login';
        throw error;
      }
    }

    return response;
  }

  private async refreshToken(): Promise<void> {
    const refreshToken = localStorage.getItem('refreshToken');
    if (!refreshToken) {
      throw new Error('No refresh token available');
    }

    const response = await fetch(`${this.baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });

    if (!response.ok) {
      throw new Error('Failed to refresh token');
    }

    const data = await response.json();
    localStorage.setItem('accessToken', data.accessToken);
    localStorage.setItem('refreshToken', data.refreshToken);
  }

  // Auth Methods
  async register(data: {
    email: string;
    password: string;
    name: string;
    department?: string;
    role?: 'EMPLOYEE' | 'TEAM_LEAD' | 'ADMIN';
  }) {
    const response = await this.request('/auth/register', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return response.json();
  }

  async login(email: string, password: string) {
    const response = await this.request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    const data = await response.json();
    localStorage.setItem('accessToken', data.accessToken);
    localStorage.setItem('refreshToken', data.refreshToken);
    return data;
  }

  async logout() {
    try {
      await this.request('/auth/logout', { method: 'POST' });
    } finally {
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
    }
  }

  async getCurrentUser() {
    const response = await this.request('/auth/me');
    return response.json();
  }

  async forgotPassword(email: string) {
    const response = await this.request('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
    return response.json();
  }

  async resetPassword(token: string, password: string) {
    const response = await this.request('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token, password }),
    });
    return response.json();
  }

  async changePassword(currentPassword: string, newPassword: string) {
    const response = await this.request('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    // Password changed, tokens invalidated
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    return response.json();
  }

  // Generic methods
  async get(endpoint: string) {
    const response = await this.request(endpoint, { method: 'GET' });
    return response.json();
  }

  async post(endpoint: string, data: any) {
    const response = await this.request(endpoint, {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return response.json();
  }

  async put(endpoint: string, data: any) {
    const response = await this.request(endpoint, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
    return response.json();
  }

  async delete(endpoint: string) {
    const response = await this.request(endpoint, { method: 'DELETE' });
    return response.json();
  }
}

// Export singleton instance
export const api = new ApiClient();
```

### React Hook Example

```typescript
import { useState, useEffect, useCallback } from 'react';

interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  emailVerified: boolean;
}

export const useAuth = () => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const api = new ApiClient();

  // Check if user is authenticated on mount
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const accessToken = localStorage.getItem('accessToken');
        if (!accessToken) {
          setLoading(false);
          return;
        }

        const userData = await api.getCurrentUser();
        setUser(userData);
      } catch (err) {
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
      } finally {
        setLoading(false);
      }
    };

    checkAuth();
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    try {
      setError(null);
      const data = await api.login(email, password);
      setUser(data.user);
      return data;
    } catch (err: any) {
      setError(err.message || 'Login failed');
      throw err;
    }
  }, []);

  const register = useCallback(
    async (data: { email: string; password: string; name: string; department?: string }) => {
      try {
        setError(null);
        const result = await api.register(data);
        setUser(result.user);
        return result;
      } catch (err: any) {
        setError(err.message || 'Registration failed');
        throw err;
      }
    },
    [],
  );

  const logout = useCallback(async () => {
    try {
      await api.logout();
      setUser(null);
    } catch (err) {
      // Even if logout fails, clear local state
      setUser(null);
    }
  }, []);

  const forgotPassword = useCallback(async (email: string) => {
    try {
      setError(null);
      return await api.forgotPassword(email);
    } catch (err: any) {
      setError(err.message || 'Failed to send reset email');
      throw err;
    }
  }, []);

  const resetPassword = useCallback(async (token: string, password: string) => {
    try {
      setError(null);
      return await api.resetPassword(token, password);
    } catch (err: any) {
      setError(err.message || 'Failed to reset password');
      throw err;
    }
  }, []);

  const changePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    try {
      setError(null);
      const result = await api.changePassword(currentPassword, newPassword);
      setUser(null); // Logout after password change
      return result;
    } catch (err: any) {
      setError(err.message || 'Failed to change password');
      throw err;
    }
  }, []);

  return {
    user,
    loading,
    error,
    login,
    register,
    logout,
    forgotPassword,
    resetPassword,
    changePassword,
    isAuthenticated: !!user,
  };
};
```

### React Component Example

```typescript
import { useAuth } from './hooks/useAuth';

function LoginPage() {
  const { login, error, loading } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await login(email, password);
      // Redirect to dashboard
      window.location.href = '/dashboard';
    } catch (err) {
      // Error is handled by hook
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      {error && <div className="error">{error}</div>}
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Email"
        required
      />
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Password"
        required
      />
      <button type="submit" disabled={loading}>
        {loading ? 'Logging in...' : 'Login'}
      </button>
    </form>
  );
}
```

### Password Reset Flow Example

```typescript
// Step 1: Request password reset
async function handleForgotPassword(email: string) {
  try {
    const response = await fetch('http://localhost:3001/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const data = await response.json();
    // Show success message (same message regardless of email existence)
    alert(data.message);
  } catch (error) {
    console.error('Error:', error);
  }
}

// Step 2: Reset password (after user clicks link in email)
async function handleResetPassword(token: string, newPassword: string) {
  try {
    const response = await fetch('http://localhost:3001/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, password: newPassword }),
    });
    const data = await response.json();
    // Show success and redirect to login
    alert(data.message);
    window.location.href = '/login';
  } catch (error: any) {
    alert(error.message || 'Failed to reset password');
  }
}
```

---

## 🧪 Testing

### Test Credentials

After running migrations and seed:

```json
{
  "email": "admin@devsloop.com",
  "password": "SecurePassword123!"
}
```

**Note:** Passwords must meet strength requirements. Check backend console logs for reset tokens during development.

### cURL Examples

```bash
# Register
curl -X POST http://localhost:3001/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@devsloop.com","password":"SecurePass123!","name":"Test User"}'

# Login
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@devsloop.com","password":"SecurePass123!"}'

# Get Current User
curl http://localhost:3001/api/auth/me \
  -H "Authorization: Bearer <accessToken>"

# Forgot Password
curl -X POST http://localhost:3001/api/auth/forgot-password \
  -H "Content-Type: application/json" \
  -d '{"email":"test@devsloop.com"}'

# Reset Password (check backend logs for token)
curl -X POST http://localhost:3001/api/auth/reset-password \
  -H "Content-Type: application/json" \
  -d '{"token":"<token-from-console>","password":"NewSecurePass123!"}'

# Change Password
curl -X POST http://localhost:3001/api/auth/change-password \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <accessToken>" \
  -d '{"currentPassword":"OldPass123!","newPassword":"NewSecurePass123!"}'
```

---

## 📝 Important Notes

### Token Management

1. **Storage:** Store tokens securely (consider httpOnly cookies for production)
2. **Refresh:** Implement automatic token refresh before expiration (15 min)
3. **Expiration:** Access tokens expire quickly - handle 401 errors gracefully
4. **Invalidation:** Tokens are invalidated on password reset/change

### Password Requirements

All passwords must meet these requirements:

- Minimum 8 characters
- At least one uppercase letter (A-Z)
- At least one lowercase letter (a-z)
- At least one number (0-9)
- At least one special character (@$!%\*?&)

### Rate Limiting

- **Login:** 5 attempts per minute
- **Forgot Password:** 3 attempts per minute
- **Resend Verification:** 3 attempts per minute
- **Global:** 100 requests per minute

### Security Best Practices

1. **User Enumeration:** Forgot password endpoint doesn't reveal if email exists
2. **Token Rotation:** Refresh tokens rotate on each use
3. **Password Reset:** All refresh tokens invalidated on password reset/change
4. **HTTPS:** Always use HTTPS in production
5. **Error Messages:** Don't expose sensitive information in error messages

### CORS Configuration

API is configured for:

- **Development:** `http://localhost:3000` (Next.js frontend)
- **Production:** Update `CORS_ORIGIN` in environment variables

---

## 🔗 Resources

- **Swagger UI:** http://localhost:3001/api/docs - Interactive API documentation
- **Backend README:** Check `README.md` for setup instructions
- **Support:** Contact backend team for API-related issues

---

## 📋 Quick Reference

### Endpoint Summary

| Endpoint                    | Method | Auth     | Description              |
| --------------------------- | ------ | -------- | ------------------------ |
| `/auth/register`            | POST   | Public   | Register new user        |
| `/auth/login`               | POST   | Public   | Login user               |
| `/auth/refresh`             | POST   | Public   | Refresh tokens           |
| `/auth/logout`              | POST   | Required | Logout user              |
| `/auth/me`                  | GET    | Required | Get current user         |
| `/auth/verify-email`        | POST   | Public   | Verify email             |
| `/auth/resend-verification` | POST   | Public   | Resend verification code |
| `/auth/forgot-password`     | POST   | Public   | Request password reset   |
| `/auth/reset-password`      | POST   | Public   | Reset password           |
| `/auth/change-password`     | POST   | Required | Change password          |

### Common Patterns

**Making Authenticated Requests:**

```typescript
const response = await fetch(`${API_BASE_URL}/endpoint`, {
  headers: {
    Authorization: `Bearer ${localStorage.getItem('accessToken')}`,
    'Content-Type': 'application/json',
  },
});
```

**Handling Token Expiration:**

```typescript
if (response.status === 401) {
  // Try to refresh token
  await refreshToken();
  // Retry request with new token
}
```

**Error Handling:**

```typescript
try {
  const data = await api.login(email, password);
} catch (error: any) {
  if (error.statusCode === 401) {
    // Invalid credentials
  } else if (error.statusCode === 429) {
    // Rate limited
  } else {
    // Other error
  }
}
```

---

**Last Updated:** January 2024  
**API Version:** 1.0  
**Status:** ✅ Production-Ready
