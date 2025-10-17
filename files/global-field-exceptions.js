/**
 * Global Field Exceptions Reference
 * 
 * These field exceptions are hardcoded in the Coursedog codebase and apply automatically
 * to ALL schools during integrations. They cannot be modified through the API or UI.
 * 
 * Source: server/rest_operations/integration/subdomains/mergeSettings/constants/globalFieldExceptions.ts
 * 
 * IMPORTANT: These exceptions are applied in addition to user-configured exceptions
 * and take precedence over the default conflictHandlingMethod.
 */

// General field exceptions that apply to ALL entity types
const GENERAL_FIELD_EXCEPTIONS = {
  workflowStep: 'alwaysCoursedog',
  version: 'alwaysCoursedog',
  lastSyncedAt: 'alwaysCoursedog',
  lastSyncStatus: 'alwaysCoursedog',
  lastSyncErrors: 'alwaysCoursedog',
  lastSyncErrorRecommendations: 'alwaysCoursedog',
  lastSyncMergeReportId: 'alwaysCoursedog',
  objectMergeSettings: 'alwaysCoursedog',
  createdAt: 'alwaysCoursedog',
  createdBy: 'alwaysCoursedog',
  lastEditedAt: 'alwaysCoursedog',
  lastEditedBy: 'alwaysCoursedog',
  allowIntegration: 'alwaysCoursedog'
};

// Entity type-specific global field exceptions
const GLOBAL_FIELD_EXCEPTIONS = {
  // Terms (EntityTypeEnum.Terms)
  terms: {
    ...GENERAL_FIELD_EXCEPTIONS,
    phaseId: 'alwaysCoursedog'
  },

  // Sections (EntityTypeEnum.Sections) - Most complex with 28 total exceptions
  sections: {
    ...GENERAL_FIELD_EXCEPTIONS,
    // Section-specific exceptions
    linkedSections: 'alwaysCoursedog',
    crossEnrolledSections: 'alwaysCoursedog',
    relationships: 'alwaysCoursedog',
    createdInternally: 'alwaysCoursedog',
    ruleExceptions: 'alwaysCoursedog',
    requests: 'alwaysCoursedog',
    preferredBuilding: 'alwaysCoursedog',
    preferredBuildings: 'alwaysCoursedog',
    preferredRoomType: 'alwaysCoursedog',
    preferredRoomCapacity: 'alwaysCoursedog',
    preferredRoomFeatures: 'alwaysCoursedog',
    doRoomScheduling: 'alwaysCoursedog',
    // Nested field exceptions
    'times.$.timeBlockId': 'alwaysCoursedog',
    'customFields.secTopicCode': 'alwaysInstitution',
    'professorsMeta.$.instructorId': 'resolveAsInstitution'
  },

  // Courses (EntityTypeEnum.Courses, EntityTypeEnum.CoursesCm)
  courses: {
    ...GENERAL_FIELD_EXCEPTIONS,
    requisites: 'alwaysCoursedog',
    learningOutcomes: 'alwaysCoursedog',
    learningOutcomesV2: 'alwaysCoursedog',
    rolloverSetting: 'alwaysCoursedog',
    owners: 'alwaysCoursedog',
    requestId: 'alwaysCoursedog',
    requestStatus: 'alwaysCoursedog',
    files: 'alwaysCoursedog'
  },

  // Relationships (EntityTypeEnum.Relationships)
  relationships: {
    ...GENERAL_FIELD_EXCEPTIONS,
    courseIds: 'alwaysCoursedog',
    sectionNumbers: 'alwaysCoursedog'
  },

  // Events (EntityTypeEnum.Events) - Only general exceptions
  events: {
    ...GENERAL_FIELD_EXCEPTIONS
  },

  // Program Maps (EntityTypeEnum.ProgramMaps)
  programMaps: {
    ...GENERAL_FIELD_EXCEPTIONS,
    'semesters.$.sisId': 'alwaysInstitution',
    'semesters.$.requirements.$.sisId': 'alwaysInstitution'
  },

  // Students (EntityTypeEnum.Students)
  students: {
    ...GENERAL_FIELD_EXCEPTIONS,
    'customFields.deprecatedShuffledId': 'alwaysCoursedog'
  },

  // Student Audits (EntityTypeEnum.StudentAudits)
  studentAudits: {
    ...GENERAL_FIELD_EXCEPTIONS,
    'customFields.deprecatedShuffledId': 'alwaysCoursedog'
  },

  // Student Course History (EntityTypeEnum.StudentCourseHistory)
  studentCourseHistory: {
    ...GENERAL_FIELD_EXCEPTIONS,
    'customFields.deprecatedShuffledId': 'alwaysCoursedog'
  },

  // Student Program History (EntityTypeEnum.StudentProgramHistory)
  studentProgramHistory: {
    ...GENERAL_FIELD_EXCEPTIONS,
    'customFields.deprecatedShuffledId': 'alwaysCoursedog'
  },

  // Program Goals (EntityTypeEnum.ProgramGoals)
  programGoals: {
    ...GENERAL_FIELD_EXCEPTIONS,
    programMapId: 'alwaysCoursedog'
  },

  // Rooms (EntityTypeEnum.Rooms)
  rooms: {
    ...GENERAL_FIELD_EXCEPTIONS,
    subRooms: 'alwaysCoursedog',
    subRoomsNotes: 'alwaysCoursedog',
    parentRooms: 'alwaysCoursedog'
  },

  // Professors (EntityTypeEnum.Professors)
  professors: {
    ...GENERAL_FIELD_EXCEPTIONS,
    workload: 'alwaysCoursedog'
  }
};

/**
 * Get global field exception for a specific field path and entity type
 * @param {string} fieldPath - The field path (e.g., 'createdAt', 'customFields.secTopicCode')
 * @param {string} entityType - The entity type (e.g., 'sections', 'courses')
 * @returns {string|null} - The global field exception value or null if not found
 */
function getGlobalFieldException(fieldPath, entityType) {
  const entityExceptions = GLOBAL_FIELD_EXCEPTIONS[entityType];
  if (!entityExceptions) {
    return null;
  }
  
  // Direct match
  if (entityExceptions[fieldPath]) {
    return entityExceptions[fieldPath];
  }
  
  // Check for parent field inheritance (e.g., 'relationships' should inherit to 'relationships.$.createdAt')
  const pathParts = fieldPath.split('.');
  for (let i = pathParts.length - 1; i > 0; i--) {
    const parentPath = pathParts.slice(0, i).join('.');
    if (entityExceptions[parentPath]) {
      return entityExceptions[parentPath];
    }
  }
  
  return null;
}

/**
 * Get all global field exceptions for an entity type
 * @param {string} entityType - The entity type
 * @returns {Object} - Object with field paths as keys and exception values as values
 */
function getAllGlobalFieldExceptions(entityType) {
  return GLOBAL_FIELD_EXCEPTIONS[entityType] || {};
}

/**
 * Check if a field has a global exception
 * @param {string} fieldPath - The field path
 * @param {string} entityType - The entity type
 * @returns {boolean} - True if the field has a global exception
 */
function hasGlobalFieldException(fieldPath, entityType) {
  return getGlobalFieldException(fieldPath, entityType) !== null;
}

/**
 * Get the source of a field exception (global, configured, or default)
 * @param {string} fieldPath - The field path
 * @param {string} entityType - The entity type
 * @param {Object} mergeSettings - The merge settings object
 * @returns {Object} - { value: string, source: 'global'|'configured'|'default' }
 */
function resolveFieldException(fieldPath, entityType, mergeSettings) {
  // Layer 1: Check global field exceptions
  const globalValue = getGlobalFieldException(fieldPath, entityType);
  if (globalValue) {
    return { value: globalValue, source: 'global' };
  }
  
  // Layer 2: Check user-configured field exceptions
  const configuredExceptions = mergeSettings?.fieldExceptions || [];
  for (const exceptionGroup of configuredExceptions) {
    for (const field of exceptionGroup.fields) {
      const configuredPath = field.path.join('.');
      if (configuredPath === fieldPath) {
        return { value: exceptionGroup.conflictHandlingMethod, source: 'configured' };
      }
    }
  }
  
  // Layer 3: Use default
  const defaultValue = mergeSettings?.conflictHandlingMethod || 'resolveAsCoursedog';
  return { value: defaultValue, source: 'default' };
}

/**
 * Format field exception display with source indicator
 * @param {Object} resolution - The field exception resolution object
 * @returns {string} - Formatted display string
 */
function formatFieldExceptionDisplay(resolution) {
  const sourceIcon = resolution.source === 'global' ? '🌐' : 
                    resolution.source === 'configured' ? '⚙️' : '🔄';
  return `${sourceIcon} \`${resolution.value}\` (${resolution.source})`;
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    GLOBAL_FIELD_EXCEPTIONS,
    GENERAL_FIELD_EXCEPTIONS,
    getGlobalFieldException,
    getAllGlobalFieldExceptions,
    hasGlobalFieldException,
    resolveFieldException,
    formatFieldExceptionDisplay
  };
}
