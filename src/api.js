// API configuration
const API_URL = '/api';

// Get stored auth token
function getToken() {
  return localStorage.getItem('token');
}

// Set auth token
export function setToken(token) {
  if (token) {
    localStorage.setItem('token', token);
  } else {
    localStorage.removeItem('token');
  }
}

// Get stored user
export function getStoredUser() {
  const user = localStorage.getItem('user');
  return user ? JSON.parse(user) : null;
}

// Set stored user
export function setStoredUser(user) {
  if (user) {
    localStorage.setItem('user', JSON.stringify(user));
  } else {
    localStorage.removeItem('user');
  }
}

// Clear auth
export function clearAuth() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
}

// API request helper
async function request(endpoint, options = {}) {
  const token = getToken();
  
  const config = {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
      ...options.headers,
    },
  };

  let response;
  try {
    response = await fetch(`${API_URL}${endpoint}`, config);
  } catch (err) {
    console.error(`[API] Erro de conexão: ${endpoint}`, err);
    throw new Error(`Erro de conexão com o servidor. Verifique sua internet. [${endpoint}]`);
  }
  
  // Handle rate limiting (429)
  if (response.status === 429) {
    console.error(`[API] Rate limit: ${endpoint}`);
    throw new Error(`Muitas requisições. Aguarde alguns minutos. [429]`);
  }
  
  // Handle unauthorized (401)
  if (response.status === 401) {
    // Only redirect if there was a token (session expired)
    // If no token, it's a failed login attempt - just throw error
    if (token) {
      clearAuth();
      window.location.reload();
      return new Promise(() => {});
    }
    // No token = login attempt failed, let it fall through to error handling
  }

  // Try to parse JSON, handle non-JSON responses
  let data;
  let rawText;
  try {
    rawText = await response.text();
    data = rawText ? JSON.parse(rawText) : {};
  } catch (err) {
    console.error(`[API] Erro ao parsear JSON: ${endpoint}`, rawText?.substring(0, 500));
    throw new Error(`Erro ao processar resposta do servidor. [${response.status}] ${endpoint}`);
  }

  if (!response.ok) {
    const errorMsg = data.error || data.message || `Erro ${response.status}`;
    const errorCode = data.code || response.status;
    console.error(`[API] Erro ${response.status}: ${endpoint}`, data);
    throw new Error(`${errorMsg} [${errorCode}]`);
  }

  return data;
}

// ==========================================
// AUTH API
// ==========================================

export const authApi = {
  async login(email, password) {
    const data = await request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    setToken(data.token);
    setStoredUser(data.user);
    return data;
  },

  async getMe() {
    return request('/auth/me');
  },

  async changePassword(currentPassword, newPassword) {
    return request('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    });
  },

  async forgotPassword(email) {
    return request('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
  },

  async resetPassword(token, newPassword) {
    return request('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token, newPassword }),
    });
  },

  logout() {
    clearAuth();
  },
};

// ==========================================
// USERS API
// ==========================================

export const usersApi = {
  async getAll() {
    return request('/users');
  },

  async getCollaborators(diagnosticId = null) {
    const query = diagnosticId ? `?diagnostic_id=${diagnosticId}` : '';
    return request(`/users/collaborators${query}`);
  },

  async getAdmins() {
    return request('/users/admins');
  },

  async create(userData) {
    return request('/users', {
      method: 'POST',
      body: JSON.stringify(userData),
    });
  },

  async update(id, userData) {
    return request(`/users/${id}`, {
      method: 'PUT',
      body: JSON.stringify(userData),
    });
  },

  async delete(id) {
    return request(`/users/${id}`, {
      method: 'DELETE',
    });
  },

  async resendEmail(id) {
    return request(`/users/${id}/resend-email`, {
      method: 'POST',
    });
  },

  async createBatch(data) {
    return request('/users/batch', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },
};

// ==========================================
// DEPARTMENTS API
// ==========================================

export const departmentsApi = {
  async getAll() {
    return request('/departments');
  },

  async get(id) {
    return request(`/departments/${id}`);
  },

  async create(data) {
    return request('/departments', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async update(id, data) {
    return request(`/departments/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  async delete(id) {
    return request(`/departments/${id}`, {
      method: 'DELETE',
    });
  },
};

// ==========================================
// RESPONSES API
// ==========================================

export const responsesApi = {
  async getPending() {
    return request('/responses/pending');
  },

  async checkIfResponded(diagnosticId = null) {
    const query = diagnosticId ? `?diagnostic_id=${diagnosticId}` : '';
    return request(`/responses/check${query}`);
  },

  async submit(data) {
    return request('/responses', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async getAll(departmentId = null, diagnosticId = null) {
    const params = new URLSearchParams();
    if (departmentId) params.append('department_id', departmentId);
    if (diagnosticId) params.append('diagnostic_id', diagnosticId);
    const query = params.toString() ? `?${params.toString()}` : '';
    return request(`/responses${query}`);
  },

  async getStats(departmentId = null, diagnosticId = null, demoFilters = {}) {
    const params = new URLSearchParams();
    if (departmentId) params.append('department_id', departmentId);
    if (diagnosticId) params.append('diagnostic_id', diagnosticId);
    if (Object.keys(demoFilters).length > 0) {
      params.append('demo_filters', JSON.stringify(demoFilters));
    }
    const query = params.toString() ? `?${params.toString()}` : '';
    return request(`/responses/stats${query}`);
  },

  async getOpenAnswers(departmentId = null, diagnosticId = null) {
    const params = [];
    if (departmentId) params.push(`department_id=${departmentId}`);
    if (diagnosticId) params.push(`diagnostic_id=${diagnosticId}`);
    const query = params.length > 0 ? `?${params.join('&')}` : '';
    return request(`/responses/open-answers${query}`);
  },

  async clearAll(diagnosticId = null) {
    const query = diagnosticId ? `?diagnostic_id=${diagnosticId}` : '';
    return request(`/responses/all${query}`, {
      method: 'DELETE',
    });
  },

  async exportCSV(diagnosticId) {
    const token = localStorage.getItem('token');
    const response = await fetch(`${API_URL}/responses/export/csv?diagnostic_id=${diagnosticId}`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Erro ao exportar');
    }
    
    // Get filename from Content-Disposition header
    const disposition = response.headers.get('Content-Disposition');
    let filename = 'exportacao.csv';
    if (disposition) {
      const match = disposition.match(/filename="(.+)"/);
      if (match) filename = match[1];
    }
    
    // Download the file
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  },
};

// ==========================================
// DIAGNOSTICS API
// ==========================================

export const diagnosticsApi = {
  async getAll() {
    return request('/diagnostics');
  },

  async get(id) {
    return request(`/diagnostics/${id}`);
  },

  async getQuestions(id) {
    return request(`/diagnostics/${id}/questions`);
  },

  async create(data) {
    return request('/diagnostics', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async update(id, data) {
    return request(`/diagnostics/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  async delete(id) {
    return request(`/diagnostics/${id}`, {
      method: 'DELETE',
    });
  },

  async generate(data) {
    return request('/diagnostics/generate', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  // Dimensions
  async addDimension(diagnosticId, data) {
    return request(`/diagnostics/${diagnosticId}/dimensions`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async updateDimension(dimensionId, data) {
    return request(`/diagnostics/dimensions/${dimensionId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  async deleteDimension(dimensionId) {
    return request(`/diagnostics/dimensions/${dimensionId}`, {
      method: 'DELETE',
    });
  },

  // Questions
  async addQuestion(dimensionId, data) {
    return request(`/diagnostics/dimensions/${dimensionId}/questions`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async updateQuestion(questionId, data) {
    return request(`/diagnostics/questions/${questionId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  async deleteQuestion(questionId) {
    return request(`/diagnostics/questions/${questionId}`, {
      method: 'DELETE',
    });
  },

  // Departments per diagnostic
  async getDepartments(diagnosticId) {
    return request(`/diagnostics/${diagnosticId}/departments`);
  },

  async addDepartment(diagnosticId, data) {
    return request(`/diagnostics/${diagnosticId}/departments`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async updateDepartment(departmentId, data) {
    return request(`/diagnostics/departments/${departmentId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  async deleteDepartment(departmentId) {
    return request(`/diagnostics/departments/${departmentId}`, {
      method: 'DELETE',
    });
  },

  // Import from document
  async parseDocument(content, filename, fileData = null, fileType = null) {
    return request('/diagnostics/import/parse', {
      method: 'POST',
      body: JSON.stringify({ content, filename, fileData, fileType }),
    });
  },

  async createFromImport(data) {
    return request('/diagnostics/import/create', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  // Enrollments
  async getEnrollments(diagnosticId) {
    return request(`/diagnostics/${diagnosticId}/enrollments`);
  },

  async getAvailableUsers(diagnosticId) {
    return request(`/diagnostics/${diagnosticId}/available-users`);
  },

  async enrollUsers(diagnosticId, userIds) {
    return request(`/diagnostics/${diagnosticId}/enroll`, {
      method: 'POST',
      body: JSON.stringify({ user_ids: userIds }),
    });
  },

  async enrollDepartment(diagnosticId, departmentId) {
    return request(`/diagnostics/${diagnosticId}/enroll`, {
      method: 'POST',
      body: JSON.stringify({ department_id: departmentId }),
    });
  },

  async enrollAll(diagnosticId) {
    return request(`/diagnostics/${diagnosticId}/enroll-all`, {
      method: 'POST',
    });
  },

  async removeEnrollment(diagnosticId, userId) {
    return request(`/diagnostics/${diagnosticId}/enroll/${userId}`, {
      method: 'DELETE',
    });
  },

  // Test data generation
  async generateTestData(diagnosticId, count) {
    return request(`/diagnostics/${diagnosticId}/generate-test-data`, {
      method: 'POST',
      body: JSON.stringify({ count }),
    });
  },

  async clearTestData(diagnosticId) {
    return request(`/diagnostics/${diagnosticId}/test-data`, {
      method: 'DELETE',
    });
  },

  // RH Access Management
  async getAccess(diagnosticId) {
    return request(`/diagnostics/${diagnosticId}/access`);
  },

  async getAvailableRH(diagnosticId) {
    return request(`/diagnostics/${diagnosticId}/access/available`);
  },

  async grantAccess(diagnosticId, userId) {
    return request(`/diagnostics/${diagnosticId}/access`, {
      method: 'POST',
      body: JSON.stringify({ user_id: userId }),
    });
  },

  async revokeAccess(diagnosticId, userId) {
    return request(`/diagnostics/${diagnosticId}/access/${userId}`, {
      method: 'DELETE',
    });
  },
};
