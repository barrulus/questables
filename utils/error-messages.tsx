// User-friendly error messages and recovery suggestions
export const ERROR_MESSAGES = {
  // Network and connection errors
  NETWORK_ERROR: {
    title: 'Connection Problem',
    message: 'Unable to connect to the server. Please check your internet connection.',
    suggestions: [
      'Check your internet connection',
      'Try refreshing the page',
      'Contact support if the problem persists'
    ],
    icon: '🌐'
  },
  
  DATABASE_ERROR: {
    title: 'Database Connection Issue',
    message: 'We\'re having trouble connecting to our database.',
    suggestions: [
      'This is usually temporary - try again in a moment',
      'Check if you\'re still connected to the internet',
      'Contact support if this keeps happening'
    ],
    icon: '🗄️'
  },
  
  TIMEOUT_ERROR: {
    title: 'Request Timed Out',
    message: 'The request took too long to complete.',
    suggestions: [
      'Try again - the server might be busy',
      'Check your internet connection speed',
      'Try breaking large operations into smaller parts'
    ],
    icon: '⏱️'
  },

  // Authentication errors
  AUTHENTICATION_REQUIRED: {
    title: 'Please Sign In',
    message: 'You need to sign in to access this feature.',
    suggestions: [
      'Click the sign in button',
      'Create an account if you don\'t have one',
      'Check if your session has expired'
    ],
    icon: '🔐'
  },
  
  INVALID_CREDENTIALS: {
    title: 'Sign In Failed',
    message: 'The email or password you entered is incorrect.',
    suggestions: [
      'Double-check your email address',
      'Make sure your password is correct',
      'Try resetting your password if needed'
    ],
    icon: '❌'
  },
  
  TOKEN_EXPIRED: {
    title: 'Session Expired',
    message: 'Your session has expired. Please sign in again.',
    suggestions: [
      'Sign in again to continue',
      'Your data has been saved',
      'Consider staying signed in longer'
    ],
    icon: '⏰'
  },

  // Authorization errors
  ACCESS_DENIED: {
    title: 'Access Denied',
    message: 'You don\'t have permission to perform this action.',
    suggestions: [
      'Make sure you\'re signed in to the correct account',
      'Contact the campaign DM for permissions',
      'Check if you\'re in the right campaign'
    ],
    icon: '🚫'
  },
  
  INSUFFICIENT_PERMISSIONS: {
    title: 'Insufficient Permissions',
    message: 'You need additional permissions to do this.',
    suggestions: [
      'Only DMs can perform this action',
      'Ask the campaign DM to make changes',
      'Check your role in the campaign'
    ],
    icon: '🔒'
  },

  // Validation errors
  VALIDATION_ERROR: {
    title: 'Invalid Information',
    message: 'Some of the information you entered is not valid.',
    suggestions: [
      'Check the highlighted fields',
      'Make sure all required fields are filled',
      'Follow the format requirements shown'
    ],
    icon: '⚠️'
  },
  
  REQUIRED_FIELD_MISSING: {
    title: 'Missing Required Information',
    message: 'Please fill in all required fields.',
    suggestions: [
      'Look for fields marked with *',
      'All highlighted fields must be completed',
      'Check that you\'ve filled everything out'
    ],
    icon: '📝'
  },

  // Character-specific errors
  CHARACTER_NOT_FOUND: {
    title: 'Character Not Found',
    message: 'The character you\'re looking for doesn\'t exist.',
    suggestions: [
      'Make sure you have the correct character ID',
      'Check if the character was deleted',
      'Try refreshing your character list'
    ],
    icon: '👤'
  },
  
  CHARACTER_CREATION_FAILED: {
    title: 'Character Creation Failed',
    message: 'We couldn\'t create your character.',
    suggestions: [
      'Check that all ability scores are valid (1-30)',
      'Make sure your character level is 1-20',
      'Verify all required fields are filled'
    ],
    icon: '🎭'
  },

  // Campaign-specific errors
  CAMPAIGN_NOT_FOUND: {
    title: 'Campaign Not Found',
    message: 'The campaign you\'re looking for doesn\'t exist.',
    suggestions: [
      'Check the campaign link or ID',
      'Ask the DM to verify the campaign exists',
      'Try searching for the campaign name'
    ],
    icon: '🗺️'
  },
  
  CAMPAIGN_FULL: {
    title: 'Campaign Full',
    message: 'This campaign has reached its maximum number of players.',
    suggestions: [
      'Ask the DM if they can increase the limit',
      'Look for other open campaigns',
      'Wait for a spot to open up'
    ],
    icon: '👥'
  },
  
  NOT_CAMPAIGN_MEMBER: {
    title: 'Not a Campaign Member',
    message: 'You need to be a member of this campaign to access it.',
    suggestions: [
      'Ask the DM to invite you',
      'Check if you\'re signed in to the right account',
      'Look for public campaigns to join'
    ],
    icon: '🚪'
  },

  // File upload errors
  FILE_TOO_LARGE: {
    title: 'File Too Large',
    message: 'The file you\'re trying to upload is too big.',
    suggestions: [
      'Reduce the image size or quality',
      'Use a different file format',
      'Split large files into smaller parts'
    ],
    icon: '📁'
  },
  
  INVALID_FILE_TYPE: {
    title: 'Invalid File Type',
    message: 'This file type is not supported.',
    suggestions: [
      'Use JPG, PNG, or WebP for images',
      'Check the allowed file types',
      'Convert your file to a supported format'
    ],
    icon: '🚫'
  },

  // WebSocket errors
  WEBSOCKET_DISCONNECTED: {
    title: 'Connection Lost',
    message: 'Lost connection to the server. Trying to reconnect...',
    suggestions: [
      'Check your internet connection',
      'The app will reconnect automatically',
      'Refresh if problems continue'
    ],
    icon: '🔌'
  },
  
  REALTIME_FEATURES_UNAVAILABLE: {
    title: 'Real-time Features Unavailable',
    message: 'Live updates are currently not working.',
    suggestions: [
      'You can still use the app normally',
      'Refresh to get the latest updates',
      'Real-time features will return automatically'
    ],
    icon: '⚡'
  },

  // Generic errors
  UNKNOWN_ERROR: {
    title: 'Something Went Wrong',
    message: 'We encountered an unexpected problem.',
    suggestions: [
      'Try refreshing the page',
      'Try again in a few moments',
      'Contact support if this keeps happening'
    ],
    icon: '❓'
  },
  
  SERVER_ERROR: {
    title: 'Server Error',
    message: 'Our server encountered a problem processing your request.',
    suggestions: [
      'Try again in a moment',
      'Check if the issue persists',
      'Contact support with details of what you were doing'
    ],
    icon: '🔥'
  }
};

// Helper function to get user-friendly error message
export const getErrorMessage = (errorType: string, customMessage?: string) => {
  const errorInfo = ERROR_MESSAGES[errorType as keyof typeof ERROR_MESSAGES] || ERROR_MESSAGES.UNKNOWN_ERROR;
  
  return {
    ...errorInfo,
    message: customMessage || errorInfo.message
  };
};

// Helper function to format error for display
export const formatErrorForDisplay = (error: any): {
  title: string;
  message: string;
  suggestions: string[];
  icon: string;
  technical?: string;
} => {
  // If it's already a formatted error, return it
  if (error.title && error.message && error.suggestions) {
    return error;
  }

  // Handle different error types
  if (error instanceof TypeError && error.message.includes('fetch')) {
    return getErrorMessage('NETWORK_ERROR');
  }
  
  if (error.message?.includes('timeout')) {
    return getErrorMessage('TIMEOUT_ERROR');
  }
  
  if (error.message?.includes('authentication') || error.message?.includes('token')) {
    return getErrorMessage('AUTHENTICATION_REQUIRED');
  }
  
  if (error.message?.includes('permission') || error.message?.includes('access')) {
    return getErrorMessage('ACCESS_DENIED');
  }
  
  if (error.message?.includes('validation')) {
    return getErrorMessage('VALIDATION_ERROR');
  }
  
  if (error.message?.includes('not found')) {
    return getErrorMessage('CHARACTER_NOT_FOUND');
  }
  
  // Default error message with technical details
  const defaultError = getErrorMessage('UNKNOWN_ERROR');
  return {
    ...defaultError,
    technical: error.message || 'No additional details available'
  };
};

// Context-specific error messages
export const getContextualErrorMessage = (context: string, errorType: string, customMessage?: string) => {
  const contextualMessages: Record<string, Record<string, any>> = {
    character: {
      VALIDATION_ERROR: {
        title: 'Invalid Character Data',
        message: 'There\'s a problem with your character information.',
        suggestions: [
          'Check ability scores are between 1-30',
          'Make sure character level is 1-20',
          'Verify all required fields are filled'
        ]
      }
    },
    campaign: {
      VALIDATION_ERROR: {
        title: 'Invalid Campaign Data',
        message: 'There\'s a problem with your campaign information.',
        suggestions: [
          'Campaign name must be 1-100 characters',
          'Max players must be between 1-20',
          'Check all required fields are filled'
        ]
      }
    },
    chat: {
      VALIDATION_ERROR: {
        title: 'Message Error',
        message: 'There\'s a problem with your message.',
        suggestions: [
          'Message must be 1-2000 characters',
          'Check for invalid characters',
          'Try sending a shorter message'
        ]
      }
    }
  };

  const contextMessage = contextualMessages[context]?.[errorType];
  if (contextMessage) {
    return contextMessage;
  }

  return getErrorMessage(errorType, customMessage);
};

// Recovery action helpers
export const getRecoveryActions = (errorType: string): Array<{ label: string; action: () => void }> => {
  const actions: Record<string, Array<{ label: string; action: () => void }>> = {
    NETWORK_ERROR: [
      { label: 'Try Again', action: () => window.location.reload() },
      { label: 'Check Connection', action: () => window.open('https://www.google.com', '_blank') }
    ],
    AUTHENTICATION_REQUIRED: [
      { label: 'Sign In', action: () => {/* redirect to sign in */} },
      { label: 'Create Account', action: () => {/* redirect to registration */} }
    ],
    CHARACTER_NOT_FOUND: [
      { label: 'Go to Characters', action: () => {/* navigate to character list */} },
      { label: 'Create New Character', action: () => {/* open character creation */} }
    ]
  };

  return actions[errorType] || [
    { label: 'Try Again', action: () => window.location.reload() }
  ];
};

export default ERROR_MESSAGES;