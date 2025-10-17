
/**
 * SIS compare tool + Env capture - Report Generator
 * Handles the generation of various configuration comparison reports
 */

class CoursedogReportGenerator {
  constructor(mainSchool, baselineSchool, tempData, debugLog, curriculumEnabled = true, schedulingEnabled = true, mainEnv = 'staging', baselineEnv = 'staging') {
    this.mainSchool = mainSchool;
    this.baselineSchool = baselineSchool;
    this.tempData = tempData;
    this.debugLog = debugLog;
    this.curriculumEnabled = curriculumEnabled;
    this.schedulingEnabled = schedulingEnabled;
    this.mainEnv = mainEnv;
    this.baselineEnv = baselineEnv;
    
    // Load global field exceptions
    this.loadGlobalFieldExceptions();
  }

  /**
   * Format school name with environment for table headers
   * @param {string} schoolName - The school identifier
   * @param {string} env - The environment (staging, production, etc.)
   * @returns {string} Formatted string like "school_name (Staging)"
   */
  formatSchoolHeader(schoolName, env) {
    const formatEnv = (environment) => environment.charAt(0).toUpperCase() + environment.slice(1).toLowerCase();
    return `${schoolName} (${formatEnv(env)})`;
  }

  /**
   * Load global field exceptions from the constants file
   */
  loadGlobalFieldExceptions() {
    // Import global field exceptions if available
    if (typeof GLOBAL_FIELD_EXCEPTIONS !== 'undefined') {
      this.globalFieldExceptions = GLOBAL_FIELD_EXCEPTIONS;
    } else {
      // Fallback: define inline (should be moved to separate file)
      this.globalFieldExceptions = {
        sections: {
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
          allowIntegration: 'alwaysCoursedog',
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
          'times.$.timeBlockId': 'alwaysCoursedog',
          'customFields.secTopicCode': 'alwaysInstitution',
          'professorsMeta.$.instructorId': 'resolveAsInstitution'
        },
        courses: {
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
          allowIntegration: 'alwaysCoursedog',
          requisites: 'alwaysCoursedog',
          learningOutcomes: 'alwaysCoursedog',
          learningOutcomesV2: 'alwaysCoursedog',
          rolloverSetting: 'alwaysCoursedog',
          owners: 'alwaysCoursedog',
          requestId: 'alwaysCoursedog',
          requestStatus: 'alwaysCoursedog',
          files: 'alwaysCoursedog'
        }
        // Add other entity types as needed
      };
    }
  }

  /**
   * Get global field exception for a specific field path and entity type
   */
  getGlobalFieldException(fieldPath, entityType) {
    const entityExceptions = this.globalFieldExceptions[entityType];
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
   * Resolve field exception through all three layers (global, configured, default)
   */
  resolveFieldException(fieldPath, entityType, mergeSettings) {
    // Layer 1: Check global field exceptions
    const globalValue = this.getGlobalFieldException(fieldPath, entityType);
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
   * Check if a field is explicitly configured in merge settings
   * Used to differentiate between "not configured" vs "not found" when API fails
   */
  isFieldConfigured(fieldPath, mergeSettings) {
    const configuredExceptions = mergeSettings?.fieldExceptions || [];
    for (const exceptionGroup of configuredExceptions) {
      for (const field of exceptionGroup.fields) {
        const configuredPath = field.path.join('.');
        if (configuredPath === fieldPath) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Format field exception display with source indicator
   */
  formatFieldExceptionDisplay(resolution) {
    const sourceIcon = resolution.source === 'global' ? '🌐' : 
                      resolution.source === 'configured' ? '⚙️' : '🔄';
    return `${sourceIcon} \`${resolution.value}\` (${resolution.source})`;
  }

  /**
   * Generate the main configuration comparison report
   */
  generateComparisonReport() {
    const mainEnvLabel = this.mainEnv === 'production' ? '🔴 Production' : '🧪 Staging';
    const baselineEnvLabel = this.baselineEnv === 'production' ? '🔴 Production' : '🧪 Staging';
    
    let report = `# Configuration Comparison Report\n\n`;
    report += `**Main School:** ${this.mainSchool} (${mainEnvLabel})\n`;
    report += `**Baseline School:** ${this.baselineSchool} (${baselineEnvLabel})\n`;
    report += `**Generated:** ${new Date().toLocaleString()}\n\n`;

    report += `## Executive Summary\n\n`;
    report += this.generateExecutiveSummary();

    report += `## Template Comparisons\n\n`;
    report += this.generateTemplateComparisons();

    report += `## Integration Merge Settings\n\n`;
    report += this.generateIntegrationComparisons();

    report += `## Integration Configuration Analysis\n\n`;
    report += this.generateIntegrationAnalysis();

    // Generate separate CAC Report for Main School integration data
    this.generateCACReport();

    // Generate additional comparison reports
    try {
      this.generateStepsToExecuteReport();
    } catch (error) {
      console.error('Error generating Steps To Execute report:', error);
    }
    
    // Try enhanced version first (uses complete field exception maps)
    // Falls back to basic version (explicit exceptions only) on error
    try {
      this.generateFieldExceptionsReportEnhanced();
    } catch (error) {
      console.error('Enhanced Field Exceptions report failed, falling back to basic version:', error);
      try {
        this.generateFieldExceptionsReport();
      } catch (fallbackError) {
        console.error('Error generating Field Exceptions report:', fallbackError);
      }
    }
    
    // Generate curriculum reports if enabled
    if (this.curriculumEnabled) {
      try {
        this.generateCourseTemplateReport();
      } catch (error) {
        console.error('Error generating Course Template report:', error);
      }
      
      try {
        this.generateProgramTemplateReport();
      } catch (error) {
        console.error('Error generating Program Template report:', error);
      }
    }
    
    // Generate scheduling reports if enabled
    if (this.schedulingEnabled) {
      try {
        this.generateSectionTemplateReport();
      } catch (error) {
        console.error('Error generating Section Template report:', error);
      }
    }
    
    // Generate attribute mappings and integration filters reports
    try {
      this.generateAttributeMappingsReport();
    } catch (error) {
      console.error('Error generating Attribute Mappings report:', error);
    }
    
    try {
      this.generateIntegrationFiltersReport();
    } catch (error) {
      console.error('Error generating Integration Filters report:', error);
    }

    return report;
  }

  /**
   * Generate comprehensive integration analysis report
   */
  generateIntegrationAnalysis() {
    let report = '';
    
    // Integration Settings Comparison
    report += `### Integration Settings\n\n`;
    report += this.compareIntegrationSettings();
    
    // Formatters Comparison
    report += `### Formatters Configuration\n\n`;
    report += this.compareFormatters();
    
    // Field Mappings Analysis
    report += `### Field Mappings Analysis\n\n`;
    report += this.compareFieldMappings();
    
    // Custom Fields Analysis
    report += `### Custom Fields Analysis\n\n`;
    report += this.compareCustomFields();
    
    return report;
  }

  compareIntegrationSettings() {
    const mainSettings = this.tempData['MainSchool_integrationSettings'];
    const baselineSettings = this.tempData['BaselineSchool_integrationSettings'];
    
    let comparison = '';
    
    if (mainSettings?.error || baselineSettings?.error) {
      comparison += `*Error retrieving integration settings:*\n`;
      if (mainSettings?.error) comparison += `- Main School: ${mainSettings.error}\n`;
      if (baselineSettings?.error) comparison += `- Baseline School: ${baselineSettings.error}\n`;
      comparison += `\n`;
    } else if (mainSettings && baselineSettings) {
      const mainKeys = Object.keys(mainSettings);
      const baselineKeys = Object.keys(baselineSettings);
      
      comparison += `**Settings Count:** Main: ${mainKeys.length}, Baseline: ${baselineKeys.length}\n\n`;
      
      const allKeys = new Set([...mainKeys, ...baselineKeys]);
      const differences = [];
      
      allKeys.forEach(key => {
        const mainValue = mainSettings[key];
        const baselineValue = baselineSettings[key];
        
        if (JSON.stringify(mainValue) !== JSON.stringify(baselineValue)) {
          differences.push(key);
        }
      });
      
      if (differences.length > 0) {
        comparison += `**Different Settings (${differences.length}):** ${differences.join(', ')}\n\n`;
      } else {
        comparison += `*✓ Integration settings are identical*\n\n`;
      }
    } else {
      comparison += `*Integration settings data not available for comparison*\n\n`;
    }
    
    return comparison;
  }

  compareFormatters() {
    let comparison = '';
    
    // Compare regular formatters
    const mainFormatters = this.tempData['MainSchool_formatters'];
    const baselineFormatters = this.tempData['BaselineSchool_formatters'];
    
    comparison += `#### Standard Formatters\n\n`;
    comparison += this.compareFormatterData(mainFormatters, baselineFormatters, 'standard formatters');
    
    // Compare post formatters
    const mainPostFormatters = this.tempData['MainSchool_formattersPost'];
    const baselinePostFormatters = this.tempData['BaselineSchool_formattersPost'];
    
    comparison += `#### Post Formatters\n\n`;
    comparison += this.compareFormatterData(mainPostFormatters, baselinePostFormatters, 'post formatters');
    
    return comparison;
  }

  compareFormatterData(mainData, baselineData, type) {
    let comparison = '';
    
    if (mainData?.error || baselineData?.error) {
      comparison += `*Error retrieving ${type}:*\n`;
      if (mainData?.error) comparison += `- Main School: ${mainData.error}\n`;
      if (baselineData?.error) comparison += `- Baseline School: ${baselineData.error}\n`;
      comparison += `\n`;
    } else if (mainData && baselineData) {
      const mainCount = Array.isArray(mainData) ? mainData.length : Object.keys(mainData).length;
      const baselineCount = Array.isArray(baselineData) ? baselineData.length : Object.keys(baselineData).length;
      
      comparison += `**${type.charAt(0).toUpperCase() + type.slice(1)} Count:** Main: ${mainCount}, Baseline: ${baselineCount}\n`;
      
      if (JSON.stringify(mainData) === JSON.stringify(baselineData)) {
        comparison += `*✓ ${type.charAt(0).toUpperCase() + type.slice(1)} are identical*\n\n`;
      } else {
        comparison += `*⚠️ ${type.charAt(0).toUpperCase() + type.slice(1)} have differences*\n\n`;
      }
    } else {
      comparison += `*${type.charAt(0).toUpperCase() + type.slice(1)} data not available for comparison*\n\n`;
    }
    
    return comparison;
  }

  hasValidData(data) {
    // Check if data exists and is not an error
    if (!data || data.error) {
      return false;
    }
    
    // Check if data is not empty
    if (Array.isArray(data)) {
      return data.length > 0;
    }
    
    if (typeof data === 'object') {
      const keys = Object.keys(data);
      return keys.length > 0;
    }
    
    return true;
  }

  /**
   * Get all available entity keys from merge settings for validation
   * @param {Object} mainMergeSettings - Main school merge settings
   * @param {Object} baselineMergeSettings - Baseline school merge settings
   * @returns {Set} Set of available entity keys
   */
  getAvailableEntityKeys(mainMergeSettings, baselineMergeSettings) {
    const allMergeSettingsEntities = new Set();
    
    if (mainMergeSettings && typeof mainMergeSettings === 'object') {
      Object.keys(mainMergeSettings).forEach(key => {
        if (typeof mainMergeSettings[key] === 'object' && mainMergeSettings[key] !== null) {
          allMergeSettingsEntities.add(key);
        }
      });
    }
    
    if (baselineMergeSettings && typeof baselineMergeSettings === 'object') {
      Object.keys(baselineMergeSettings).forEach(key => {
        if (typeof baselineMergeSettings[key] === 'object' && baselineMergeSettings[key] !== null) {
          allMergeSettingsEntities.add(key);
        }
      });
    }
    
    return allMergeSettingsEntities;
  }

  /**
   * Determine target entities for report generation based on formatters with fallback to enabled entities
   * Following the specification: use formatters=true entities if available, otherwise use enabled=true entities
   * @param {Object} mainMergeSettings - Main school merge settings data
   * @param {Object} baselineMergeSettings - Baseline school merge settings data
   * @returns {Array} Array of entity types to include in reports
   */
  determineTargetEntities(mainMergeSettings, baselineMergeSettings) {
    // Get formatter data for main school only
    const mainFormatters = this.tempData['MainSchool_formatters'];
    
    // Validate formatter data for main school only
    const mainFormatterValidation = this.validateFormatterData(mainFormatters, this.mainSchool);
    
    // Log validation results for debugging
    console.log('Main school formatter validation:', mainFormatterValidation);
    
    // Use formatter-enabled entities if we have valid data from main school
    if (mainFormatterValidation.isValid) {
      // Pass merge settings for validation - only need main school formatter data
      const formatterEntities = this.getFormatterEnabledEntities(
        mainFormatters, 
        mainMergeSettings, 
        baselineMergeSettings
      );
      
      if (formatterEntities.length > 0) {
        console.log('Using formatter-enabled entities from main school:', formatterEntities);
        console.log(`Total formatter-enabled entities: ${formatterEntities.length}`);
        return formatterEntities;
      } else {
        console.warn('No valid formatter-enabled entities found after merge settings validation');
      }
    } else {
      // Log why we're not using formatters
      if (mainFormatterValidation.errorMessage) {
        console.warn('Main school formatters issue:', mainFormatterValidation.errorMessage);
      }
    }
    
    // Fallback to enabled entities from merge settings
    console.log('Falling back to enabled entities from merge settings');
    const enabledEntities = this.getEnabledEntitiesFromMergeSettings(mainMergeSettings, baselineMergeSettings);
    console.log(`Total enabled entities: ${enabledEntities.length}`);
    return enabledEntities;
  }
  
  /**
   * Extract entities that have formatters=true from main school formatter data and validate against merge settings
   * @param {Object} mainFormatters - Main school formatter data
   * @param {Object} mainMergeSettings - Main school merge settings (for validation)
   * @param {Object} baselineMergeSettings - Baseline school merge settings (for validation)
   * @returns {Array} Array of merge settings entity types that have formatters enabled AND exist in merge settings
   */
  getFormatterEnabledEntities(mainFormatters, mainMergeSettings, baselineMergeSettings) {
    // Get available entity keys for validation
    const availableEntities = this.getAvailableEntityKeys(mainMergeSettings, baselineMergeSettings);
    
    const validatedEntities = [];
    const invalidEntities = [];
    
    // Process main school formatters only
    if (mainFormatters && typeof mainFormatters === 'object') {
      Object.entries(mainFormatters).forEach(([formatterKey, isEnabled]) => {
        if (isEnabled === true) {
          // Direct validation: formatter key should equal entity key
          if (availableEntities.has(formatterKey)) {
            validatedEntities.push(formatterKey);
          } else {
            invalidEntities.push(formatterKey);
            console.warn(`Formatter-enabled entity '${formatterKey}' not found in merge settings`);
          }
        }
      });
    }
    
    if (invalidEntities.length > 0) {
      console.warn('Formatter entities not found in merge settings:', invalidEntities);
    }
    
    console.log('Validated formatter-enabled entities (main school only):', validatedEntities.sort());
    return validatedEntities.sort();
  }
  
  /**
   * Validate formatter data and provide detailed error information
   * @param {Object} formatters - Formatter data to validate
   * @param {string} schoolName - Name of the school for error reporting
   * @returns {Object} Validation result with status and details
   */
  validateFormatterData(formatters, schoolName) {
    const result = {
      isValid: false,
      hasData: false,
      errorMessage: null,
      enabledCount: 0,
      unmappedFormatters: []
    };
    
    if (!formatters) {
      result.errorMessage = `No formatter data available for ${schoolName}`;
      return result;
    }
    
    if (formatters.error) {
      result.errorMessage = `Formatter API error for ${schoolName}: ${formatters.error}`;
      return result;
    }
    
    if (typeof formatters !== 'object') {
      result.errorMessage = `Invalid formatter data type for ${schoolName}: expected object, got ${typeof formatters}`;
      return result;
    }
    
    result.hasData = true;
    
    // Count enabled formatters - mapping validation will be done dynamically later
    Object.entries(formatters).forEach(([formatterKey, isEnabled]) => {
      if (isEnabled === true) {
        result.enabledCount++;
      }
    });
    
    result.isValid = result.enabledCount > 0;
    
    return result;
  }
  
  /**
   * Extract entities that have enabled=true from merge settings (fallback method)
   * @param {Object} mainMergeSettings - Main school merge settings
   * @param {Object} baselineMergeSettings - Baseline school merge settings  
   * @returns {Array} Array of entity types that are enabled in merge settings
   */
  getEnabledEntitiesFromMergeSettings(mainMergeSettings, baselineMergeSettings) {
    const enabledEntities = new Set();
    
    // Process main school merge settings
    if (mainMergeSettings && typeof mainMergeSettings === 'object') {
      Object.entries(mainMergeSettings).forEach(([entityKey, settings]) => {
        if (settings && settings.enabled === true) {
          enabledEntities.add(entityKey);
        }
      });
    }
    
    // Process baseline school merge settings
    if (baselineMergeSettings && typeof baselineMergeSettings === 'object') {
      Object.entries(baselineMergeSettings).forEach(([entityKey, settings]) => {
        if (settings && settings.enabled === true) {
          enabledEntities.add(entityKey);
        }
      });
    }
    
    return Array.from(enabledEntities).sort();
  }
  
  /**
   * Generate a debug report showing entity selection logic for testing and validation
   * @param {Object} mainMergeSettings - Main school merge settings
   * @param {Object} baselineMergeSettings - Baseline school merge settings
   * @returns {string} Debug report as markdown
   */
  generateEntitySelectionDebugReport(mainMergeSettings, baselineMergeSettings) {
    let report = `# Entity Selection Debug Report\n\n`;
    report += `**Generated:** ${new Date().toLocaleString()}\n\n`;
    
    // Formatter validation details
    const mainFormatters = this.tempData['MainSchool_formatters'];
    
    const mainValidation = this.validateFormatterData(mainFormatters, this.mainSchool);
    
    report += `## Formatter Data Analysis\n\n`;
    
    report += `### ${this.mainSchool} Formatters\n`;
    report += `- **Has Data:** ${mainValidation.hasData}\n`;
    report += `- **Is Valid:** ${mainValidation.isValid}\n`;
    report += `- **Enabled Count:** ${mainValidation.enabledCount}\n`;
    if (mainValidation.errorMessage) {
      report += `- **Error:** ${mainValidation.errorMessage}\n`;
    }
    if (mainValidation.unmappedFormatters.length > 0) {
      report += `- **Unmapped Formatters:** ${mainValidation.unmappedFormatters.join(', ')}\n`;
    }
    report += `\n`;
    
    report += `### ${this.baselineSchool} Formatters\n`;
    report += `- **Status:** Not checked (only main school formatters are used for entity selection)\n`;
    report += `\n`;
    
    // Entity selection results
    const targetEntities = this.determineTargetEntities(mainMergeSettings, baselineMergeSettings);
    const formatterEntities = this.getFormatterEnabledEntities(mainFormatters, mainMergeSettings, baselineMergeSettings);
    const enabledEntities = this.getEnabledEntitiesFromMergeSettings(mainMergeSettings, baselineMergeSettings);
    
    report += `## Entity Selection Results\n\n`;
    
    report += `### Final Target Entities (${targetEntities.length})\n`;
    if (targetEntities.length > 0) {
      targetEntities.forEach(entity => {
        report += `- ${entity}\n`;
      });
    } else {
      report += `*No target entities found*\n`;
    }
    report += `\n`;
    
    report += `### Formatter-Enabled Entities (${formatterEntities.length})\n`;
    if (formatterEntities.length > 0) {
      formatterEntities.forEach(entity => {
        report += `- ${entity}\n`;
      });
    } else {
      report += `*No formatter-enabled entities found*\n`;
    }
    report += `\n`;
    
    report += `### Merge Settings Enabled Entities (${enabledEntities.length})\n`;
    if (enabledEntities.length > 0) {
      enabledEntities.forEach(entity => {
        report += `- ${entity}\n`;
      });
    } else {
      report += `*No enabled entities found in merge settings*\n`;
    }
    report += `\n`;
    
    // Selection logic explanation
    report += `## Selection Logic Applied\n\n`;
    
    if (mainValidation.isValid) {
      if (formatterEntities.length > 0) {
        report += `✅ **Used formatter-based selection** - Found ${formatterEntities.length} formatter-enabled entities from main school\n`;
      } else {
        report += `⚠️ **Main school formatters available but no entities enabled** - Falling back to merge settings\n`;
      }
    } else {
      report += `❌ **No valid formatter data available from main school** - Using merge settings fallback\n`;
    }
    
    return report;
  }

  compareFieldMappings() {
    let comparison = '';
    
    // Get all field mapping keys
    const fieldMappingKeys = Object.keys(this.tempData).filter(key => 
      key.includes('fieldMappings_') || key.includes('fieldMappingsPost_')
    );
    
    const entityTypes = new Set();
    fieldMappingKeys.forEach(key => {
      const match = key.match(/fieldMappings(?:Post)?_(.+)$/);
      if (match) {
        entityTypes.add(match[1]);
      }
    });
    
    if (entityTypes.size === 0) {
      return `*No field mapping data available*\n\n`;
    }
    
    entityTypes.forEach(entityType => {
      comparison += `#### ${entityType.charAt(0).toUpperCase() + entityType.slice(1)} Field Mappings\n\n`;
      
      // Compare regular field mappings
      const mainMappings = this.tempData[`MainSchool_fieldMappings_${entityType}`];
      const baselineMappings = this.tempData[`BaselineSchool_fieldMappings_${entityType}`];
      
      comparison += `**Standard Mappings:**\n`;
      comparison += this.compareFormatterData(mainMappings, baselineMappings, `${entityType} field mappings`);
      
      // Compare post field mappings
      const mainPostMappings = this.tempData[`MainSchool_fieldMappingsPost_${entityType}`];
      const baselinePostMappings = this.tempData[`BaselineSchool_fieldMappingsPost_${entityType}`];
      
      comparison += `**Post Mappings:**\n`;
      comparison += this.compareFormatterData(mainPostMappings, baselinePostMappings, `${entityType} post field mappings`);
    });
    
    return comparison;
  }

  compareCustomFields() {
    let comparison = '';
    
    // Get all custom field keys
    const customFieldKeys = Object.keys(this.tempData).filter(key => 
      key.includes('customFields_') || key.includes('customFieldsPost_')
    );
    
    const entityTypes = new Set();
    customFieldKeys.forEach(key => {
      const match = key.match(/customFields(?:Post)?_(.+)$/);
      if (match) {
        entityTypes.add(match[1]);
      }
    });
    
    if (entityTypes.size === 0) {
      return `*No custom fields data available*\n\n`;
    }
    
    entityTypes.forEach(entityType => {
      comparison += `#### ${entityType.charAt(0).toUpperCase() + entityType.slice(1)} Custom Fields\n\n`;
      
      // Compare regular custom fields
      const mainFields = this.tempData[`MainSchool_customFields_${entityType}`];
      const baselineFields = this.tempData[`BaselineSchool_customFields_${entityType}`];
      
      comparison += `**Standard Custom Fields:**\n`;
      comparison += this.compareFormatterData(mainFields, baselineFields, `${entityType} custom fields`);
      
      // Compare post custom fields
      const mainPostFields = this.tempData[`MainSchool_customFieldsPost_${entityType}`];
      const baselinePostFields = this.tempData[`BaselineSchool_customFieldsPost_${entityType}`];
      
      comparison += `**Post Custom Fields:**\n`;
      comparison += this.compareFormatterData(mainPostFields, baselinePostFields, `${entityType} post custom fields`);
    });
    
    return comparison;
  }

  /**
   * Generate comprehensive CAC Report for Main School integration data
   */
  generateCACReport() {
    const mainEnvLabel = this.mainEnv === 'production' ? '🔴 Production' : '🧪 Staging';
    const baselineEnvLabel = this.baselineEnv === 'production' ? '🔴 Production' : '🧪 Staging';
    
    let report = `# CAC Integration Report - Comparison\n\n`;
    report += `**Main School:** ${this.mainSchool} (${mainEnvLabel})\n`;
    report += `**Baseline School:** ${this.baselineSchool} (${baselineEnvLabel})\n`;
    report += `**Generated:** ${new Date().toLocaleString()}\n\n`;
    report += `---\n\n`;
    report += `This report shows all queried integration configurations for both schools, including missing configurations and errors.\n\n`;
    report += `**How to Read:**\n`;
    report += `- Click on any JSON value to view the full formatted configuration\n`;
    report += `- You can open **multiple JSON popups** simultaneously for side-by-side comparison\n`;
    report += `- Drag popups by their header to reposition them\n`;
    report += `- Click anywhere on a popup to bring it to the front\n`;
    report += `- "_no config found_" indicates the configuration was not found (404) or had an error\n`;
    report += `- Sections are only shown if at least one school has data\n\n`;
    report += `---\n\n`;

    // Integration Settings
    report += this.renderCACSection('Integration Settings', 'integrationSettings');
    
    // Formatters - Standard
    report += this.renderCACSection('Standard Formatters', 'formatters');
    
    // Formatters - Post
    report += this.renderCACSection('Post Formatters', 'formattersPost');

    // Get all entity types that were queried for either school
    const allEntityTypes = this.getAllQueriedEntityTypes();
    
    if (allEntityTypes.length > 0) {
      // Field Mappings by Entity Type
      report += `## Field Mappings\n\n`;
      allEntityTypes.forEach(entityType => {
        report += this.renderCACSection(
          `${entityType.charAt(0).toUpperCase() + entityType.slice(1)} Field Mappings`, 
          `fieldMappings_${entityType}`
        );
      });
      
      // Post Field Mappings by Entity Type
      report += `## Post Field Mappings\n\n`;
      allEntityTypes.forEach(entityType => {
        report += this.renderCACSection(
          `${entityType.charAt(0).toUpperCase() + entityType.slice(1)} Post Field Mappings`, 
          `fieldMappingsPost_${entityType}`
        );
      });
      
      // Custom Fields by Entity Type
      report += `## Custom Fields\n\n`;
      allEntityTypes.forEach(entityType => {
        report += this.renderCACSection(
          `${entityType.charAt(0).toUpperCase() + entityType.slice(1)} Custom Fields`, 
          `customFields_${entityType}`
        );
      });
      
      // Post Custom Fields by Entity Type
      report += `## Post Custom Fields\n\n`;
      allEntityTypes.forEach(entityType => {
        report += this.renderCACSection(
          `${entityType.charAt(0).toUpperCase() + entityType.slice(1)} Post Custom Fields`, 
          `customFieldsPost_${entityType}`
        );
      });
    }

    // Store the CAC report in tempData for download
    this.tempData['CAC_Report'] = report;
  }

  /**
   * Render a CAC config section showing both Main and Baseline schools
   * @param {string} sectionTitle - Title of the section
   * @param {string} configKey - Key suffix (e.g., 'integrationSettings', 'formatters_courses')
   * @returns {string} Formatted section
   */
  renderCACSection(sectionTitle, configKey) {
    const mainKey = `MainSchool_${configKey}`;
    const baselineKey = `BaselineSchool_${configKey}`;
    
    const mainData = this.tempData[mainKey];
    const baselineData = this.tempData[baselineKey];
    
    // Check if both are unsuccessful - if so, skip this section
    const mainHasData = this.hasConfigData(mainData);
    const baselineHasData = this.hasConfigData(baselineData);
    
    if (!mainHasData && !baselineHasData) {
      // Both failed or missing - skip this section entirely
      return '';
    }
    
    let section = `### ${sectionTitle}\n\n`;
    
    // Get formatted content for both schools
    const mainContent = this.getConfigContentForTable(mainData);
    const baselineContent = this.getConfigContentForTable(baselineData);
    
    // Wrap in backticks like template reports do (unless it's "no config found")
    const mainCell = mainContent === '_no config found_' ? mainContent : `\`${mainContent}\``;
    const baselineCell = baselineContent === '_no config found_' ? baselineContent : `\`${baselineContent}\``;
    
    // Create comparison table with JSON side-by-side
    section += `| **Main School (${this.formatSchoolHeader(this.mainSchool, this.mainEnv)})** | **Baseline School (${this.formatSchoolHeader(this.baselineSchool, this.baselineEnv)})** |\n`;
    section += `|---|---|\n`;
    section += `| ${mainCell} | ${baselineCell} |\n\n`;
    
    return section;
  }

  /**
   * Check if config data has actual data (successful response)
   * @param {Object} configData - Config data object with metadata
   * @returns {boolean} True if has data
   */
  hasConfigData(configData) {
    if (!configData) return false;
    
    // Handle new structured format
    if (configData.status) {
      return configData.status === 'success' && configData.data;
    }
    
    // Handle legacy format - has data if no error
    return !configData.error;
  }

  /**
   * Get config content for table cell - returns formatted JSON or "no config found"
   * Uses compact JSON format so report viewer can detect and add popup functionality
   * @param {Object} configData - Config data object with metadata
   * @returns {string} Compact JSON string or "no config found" message
   */
  getConfigContentForTable(configData) {
    if (!configData) {
      return '_no config found_';
    }
    
    // Handle new structured format
    if (configData.status) {
      if (configData.status === 'success' && configData.data) {
        // Use compact JSON (single line) like template reports
        // Report viewer will auto-detect and add popup with formatted version
        return JSON.stringify(configData.data);
      } else {
        // 404, error, or not configured
        return '_no config found_';
      }
    }
    
    // Handle legacy format (direct data without metadata)
    if (configData.error) {
      return '_no config found_';
    }
    
    // Has data in legacy format - use compact format
    return JSON.stringify(configData);
  }

  /**
   * Get config content (LEGACY - with HTML formatting) - DEPRECATED
   * @param {Object} configData - Config data object with metadata
   * @returns {string} JSON string or "no config found" message
   */
  getConfigContent(configData) {
    // Use the same approach as table version
    return this.getConfigContentForTable(configData);
  }

  /**
   * Get config status information (LEGACY - kept for backward compatibility)
   * @param {Object} configData - Config data object with metadata
   * @returns {Object} Status info with statusText, hasData, and dataStr
   */
  getConfigStatusInfo(configData) {
    if (!configData) {
      return {
        statusText: '⚠ **Not queried**',
        hasData: false,
        dataStr: null
      };
    }
    
    // Handle new structured format
    if (configData.status) {
      if (configData.status === 'success' && configData.data) {
        return {
          statusText: '✓ **Config found**',
          hasData: true,
          dataStr: JSON.stringify(configData.data, null, 2)
        };
      } else if (configData.status === 'not_configured') {
        return {
          statusText: '✗ **No config found** (404)',
          hasData: false,
          dataStr: null
        };
      } else if (configData.status === 'error') {
        return {
          statusText: `⚠ **Error:** ${configData.error}`,
          hasData: false,
          dataStr: null
        };
      }
    }
    
    // Handle legacy format (direct data without metadata)
    if (configData.error) {
      return {
        statusText: `⚠ **Error:** ${configData.error}`,
        hasData: false,
        dataStr: null
      };
    }
    
    // Has data in legacy format
    return {
      statusText: '✓ **Config found**',
      hasData: true,
      dataStr: JSON.stringify(configData, null, 2)
    };
  }

  /**
   * Render the status and data for a single config (for table cells) - DEPRECATED
   * @param {Object} configData - Config data object with metadata
   * @returns {string} Formatted status and data (table-friendly)
   */
  renderConfigStatusForTable(configData) {
    const info = this.getConfigStatusInfo(configData);
    return info.statusText;
  }

  /**
   * Escape HTML special characters
   * @param {string} str - String to escape
   * @returns {string} Escaped string
   */
  escapeHtml(str) {
    if (typeof str !== 'string') return str;
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * Render the status and data for a single config (legacy method - kept for backward compatibility)
   * @param {Object} configData - Config data object with metadata
   * @returns {string} Formatted status and data
   */
  renderConfigStatus(configData) {
    if (!configData) {
      return `⚠ **Not queried** - No data available\n`;
    }
    
    // Handle new structured format
    if (configData.status) {
      if (configData.status === 'success' && configData.data) {
        return `✓ **Config found**\n\`\`\`json\n${JSON.stringify(configData.data, null, 2)}\n\`\`\`\n`;
      } else if (configData.status === 'not_configured') {
        return `✗ **No config found** (404 - Not configured)\n`;
      } else if (configData.status === 'error') {
        return `⚠ **Error retrieving config:** ${configData.error}\n`;
      }
    }
    
    // Handle legacy format (direct data without metadata)
    if (configData.error) {
      return `⚠ **Error retrieving config:** ${configData.error}\n`;
    }
    
    // Has data in legacy format
    return `✓ **Config found**\n\`\`\`json\n${JSON.stringify(configData, null, 2)}\n\`\`\`\n`;
  }

  /**
   * Get all entity types that were queried for either school
   * @returns {Array<string>} List of entity types
   */
  getAllQueriedEntityTypes() {
    const entityTypes = new Set();
    
    // Check both Main and Baseline school keys
    Object.keys(this.tempData).forEach(key => {
      if (key.includes('fieldMappings_') || key.includes('customFields_')) {
        // Extract entity type from keys like "MainSchool_fieldMappings_courses"
        const match = key.match(/_(fieldMappings|fieldMappingsPost|customFields|customFieldsPost)_(.+)/);
        if (match && match[2]) {
          entityTypes.add(match[2]);
        }
      }
    });
    
    return Array.from(entityTypes).sort();
  }

  /**
   * Generate executive summary
   */
  generateExecutiveSummary() {
    let summary = '';
    const templateTypes = ['courseTemplate', 'programTemplate', 'sectionTemplate'];
    let totalDifferences = 0;
    let templatesWithDifferences = 0;

    templateTypes.forEach(templateType => {
      const mainTemplate = this.tempData[`MainSchool_${templateType}`];
      const baselineTemplate = this.tempData[`BaselineSchool_${templateType}`];
      
      if (mainTemplate && baselineTemplate && !mainTemplate.error && !baselineTemplate.error) {
        const mainQuestions = this.extractQuestions(mainTemplate, templateType);
        const baselineQuestions = this.extractQuestions(baselineTemplate, templateType);
        const differences = this.compareQuestionsForSummary(mainQuestions, baselineQuestions);
        
        if (differences.total > 0) {
          templatesWithDifferences++;
          totalDifferences += differences.total;
        }
      }
    });

    if (totalDifferences === 0) {
      summary += `✅ **No configuration differences found** between ${this.mainSchool} and ${this.baselineSchool}.\n\n`;
      summary += `All template configurations are identical.\n\n`;
    } else {
      summary += `⚠️ **${totalDifferences} configuration differences** found across ${templatesWithDifferences} template(s).\n\n`;
      summary += `Detailed analysis is provided in the sections below.\n\n`;
    }

    return summary;
  }

  /**
   * Extract entities that have formatters=true from main school formatter data and validate against merge settings
   * @param {Object} mainFormatters - Main school formatter data
   * @param {Object} mainMergeSettings - Main school merge settings (for validation)
   * @param {Object} baselineMergeSettings - Baseline school merge settings (for validation)
   * @returns {Array} Array of merge settings entity types that have formatters enabled AND exist in merge settings
   */
  getFormatterEnabledEntities(mainFormatters, mainMergeSettings, baselineMergeSettings) {
    // Get available entity keys for validation
    const availableEntities = this.getAvailableEntityKeys(mainMergeSettings, baselineMergeSettings);
    
    const validatedEntities = [];
    const invalidEntities = [];
    
    // Process main school formatters only
    if (mainFormatters && typeof mainFormatters === 'object') {
      Object.entries(mainFormatters).forEach(([formatterKey, isEnabled]) => {
        if (isEnabled === true) {
          // Direct validation: formatter key should equal entity key
          if (availableEntities.has(formatterKey)) {
            validatedEntities.push(formatterKey);
          } else {
            invalidEntities.push(formatterKey);
            console.warn(`Formatter-enabled entity '${formatterKey}' not found in merge settings`);
          }
        }
      });
    }
    
    if (invalidEntities.length > 0) {
      console.warn('Formatter entities not found in merge settings:', invalidEntities);
    }
    
    console.log('Validated formatter-enabled entities (main school only):', validatedEntities.sort());
    return validatedEntities.sort();
  }
  
  /**
   * Generate summary of configuration differences for report header
   */
  generateTemplateSummary() {
    let summary = '## Summary\n\n';
    const templateTypes = ['courseTemplate', 'programTemplate', 'sectionTemplate'];
    let totalDifferences = 0;
    let templatesWithDifferences = 0;
    
    templateTypes.forEach(templateType => {
      const mainTemplate = this.tempData[`MainSchool_${templateType}`];
      const baselineTemplate = this.tempData[`BaselineSchool_${templateType}`];
      
      if (mainTemplate && baselineTemplate && !mainTemplate.error && !baselineTemplate.error) {
        const mainQuestions = this.extractQuestions(mainTemplate, templateType);
        const baselineQuestions = this.extractQuestions(baselineTemplate, templateType);
        const differences = this.compareQuestions(mainQuestions, baselineQuestions);
        
        if (differences.total > 0) {
          templatesWithDifferences++;
          totalDifferences += differences.total;
        }
      }
    });

    if (totalDifferences === 0) {
      summary += `✅ **No configuration differences found** between ${this.mainSchool} and ${this.baselineSchool}.\n\n`;
      summary += `All template configurations are identical.\n\n`;
    } else {
      summary += `⚠️ **${totalDifferences} configuration differences** found across ${templatesWithDifferences} template(s).\n\n`;
      summary += `Detailed analysis is provided in the sections below.\n\n`;
    }

    return summary;
  }

  /**
   * Generate template comparisons section
   */
  generateTemplateComparisons() {
    let report = '';
    const templateTypes = ['courseTemplate', 'programTemplate', 'sectionTemplate'];
    
    templateTypes.forEach(templateType => {
      report += `### ${this.formatTemplateName(templateType)}\n\n`;
      
      const mainTemplate = this.tempData[`MainSchool_${templateType}`];
      const baselineTemplate = this.tempData[`BaselineSchool_${templateType}`];
      
      if (mainTemplate?.error || baselineTemplate?.error) {
        report += `*Error retrieving data:*\n`;
        if (mainTemplate?.error) report += `- Main School: ${mainTemplate.error}\n`;
        if (baselineTemplate?.error) report += `- Baseline School: ${baselineTemplate.error}\n`;
        report += `\n`;
      } else if (mainTemplate && baselineTemplate) {
        const mainQuestions = this.extractQuestions(mainTemplate, templateType);
        const baselineQuestions = this.extractQuestions(baselineTemplate, templateType);
        
        report += this.compareQuestions(mainQuestions, baselineQuestions);
      } else {
        report += `*Data not available for comparison*\n\n`;
      }
    });

    return report;
  }

  /**
   * Generate integration comparisons section
   */
  generateIntegrationComparisons() {
    let report = '';
    const mainMergeSettings = this.tempData[`MainSchool_mergeSettings`];
    const baselineMergeSettings = this.tempData[`BaselineSchool_mergeSettings`];
    
    if (mainMergeSettings?.error || baselineMergeSettings?.error) {
      report += `*Error retrieving integration merge settings:*\n`;
      if (mainMergeSettings?.error) report += `- Main School: ${mainMergeSettings.error}\n`;
      if (baselineMergeSettings?.error) report += `- Baseline School: ${baselineMergeSettings.error}\n`;
      report += `\n`;
    } else if (mainMergeSettings && baselineMergeSettings) {
      const mainEnabled = this.getEnabledMergeTypes(mainMergeSettings);
      const baselineEnabled = this.getEnabledMergeTypes(baselineMergeSettings);
      
      report += this.compareMergeSettings(mainEnabled, baselineEnabled);
    } else {
      report += `*Integration merge settings not available for comparison*\n\n`;
    }

    return report;
  }

  /**
   * Generate debug log file
   */
  generateDebugLogFile() {
    // Check if snapshot data is available
    const snapshotKeys = Object.keys(this.tempData).filter(key => key.startsWith('snapshot_') && !key.includes('_json') && !key.includes('_markdown') && !key.includes('_status'));
    const snapshotSchools = snapshotKeys.map(key => key.replace('snapshot_', ''));
    
    let header = `# Coursedog API Debug Log
Generated: ${new Date().toISOString()}
Extension: Coursedog Configuration Reporter
Environment: https://staging.coursedog.com
Main School: ${this.mainSchool}
Baseline School: ${this.baselineSchool}`;

    if (snapshotSchools.length > 0) {
      header += `
Snapshot Schools: ${snapshotSchools.join(', ')}`;
    }

    header += `

## API Request/Response Log

`;

    let logContent = header;
    
    this.debugLog.forEach((entry, index) => {
      logContent += `### Entry ${index + 1}: ${entry.type}\n`;
      logContent += `**Timestamp:** ${entry.timestamp}\n`;
      
      if (entry.type === 'REQUEST') {
        logContent += `**Method:** ${entry.method}\n`;
        logContent += `**Endpoint:** ${entry.endpoint}\n`;
        logContent += `**Full URL:** ${entry.url}\n`;
        logContent += `**Headers:**\n\`\`\`json\n${JSON.stringify(entry.headers, null, 2)}\n\`\`\`\n`;
        if (entry.body) {
          logContent += `**Request Body:**\n\`\`\`json\n${JSON.stringify(entry.body, null, 2)}\n\`\`\`\n`;
        }
      } else if (entry.type === 'RESPONSE_SUCCESS') {
        logContent += `**Status:** ${entry.status} ${entry.statusText}\n`;
        logContent += `**Data Size:** ${entry.dataSize} characters\n`;
        logContent += `**Response Preview:**\n\`\`\`json\n${entry.dataPreview}\n\`\`\`\n`;
      } else if (entry.type === 'RESPONSE_ERROR') {
        logContent += `**Status:** ${entry.status} ${entry.statusText}\n`;
        logContent += `**Error:** ${entry.error}\n`;
      } else if (entry.type === 'NETWORK_ERROR') {
        logContent += `**Error:** ${entry.error}\n`;
      } else if (entry.type === 'NOTION_REQUEST') {
        logContent += `**Service:** Notion API\n`;
        logContent += `**Method:** ${entry.method}\n`;
        logContent += `**Endpoint:** ${entry.endpoint}\n`;
        logContent += `**Full URL:** ${entry.url}\n`;
        logContent += `**Headers:**\n\`\`\`json\n${JSON.stringify(entry.headers, null, 2)}\n\`\`\`\n`;
        if (entry.body) {
          logContent += `**Request Body Size:** ${entry.bodySize} characters\n`;
          logContent += `**Request Body:**\n\`\`\`json\n${JSON.stringify(entry.body, null, 2)}\n\`\`\`\n`;
        }
      } else if (entry.type === 'NOTION_RESPONSE_SUCCESS') {
        logContent += `**Service:** Notion API\n`;
        logContent += `**Status:** ${entry.status} ${entry.statusText}\n`;
        logContent += `**Response Size:** ${entry.responseSize} characters\n`;
        logContent += `**Response Body:**\n\`\`\`json\n${JSON.stringify(entry.response, null, 2)}\n\`\`\`\n`;
      } else if (entry.type === 'NOTION_RESPONSE_ERROR') {
        logContent += `**Service:** Notion API\n`;
        logContent += `**Status:** ${entry.status} ${entry.statusText}\n`;
        logContent += `**Error:** ${entry.error}\n`;
        logContent += `**Response Size:** ${entry.responseSize} characters\n`;
        if (entry.response) {
          logContent += `**Response Body:**\n\`\`\`json\n${JSON.stringify(entry.response, null, 2)}\n\`\`\`\n`;
        }
      }
      
      logContent += '\n---\n\n';
    });

    // Add snapshot-specific information if available
    if (snapshotSchools.length > 0) {
      logContent += `## Snapshot Tool Information

`;
      
      snapshotSchools.forEach(schoolId => {
        const snapshotData = this.tempData[`snapshot_${schoolId}`];
        const snapshotStatus = this.tempData[`snapshot_${schoolId}_status`];
        
        if (snapshotData && snapshotStatus) {
          logContent += `### Snapshot for ${schoolId}
**Request Status:** ${snapshotStatus.successful}/${snapshotStatus.total} successful
**Errors:** ${snapshotStatus.errors.length}

`;
          
          if (snapshotStatus.errors.length > 0) {
            logContent += `**Error Details:**
`;
            snapshotStatus.errors.forEach(error => {
              logContent += `- **${error.endpoint}:** ${error.message}
`;
            });
            logContent += `
`;
          }
        }
      });
    }

    return logContent;
  }

  // Helper methods
  formatTemplateName(templateType) {
    const names = {
      'courseTemplate': 'Course Template',
      'programTemplate': 'Program Template', 
      'sectionTemplate': 'Section Template'
    };
    return names[templateType] || templateType;
  }

  extractQuestions(template, templateType) {
    let questions;
    
    switch (templateType) {
      case 'courseTemplate':
        questions = this.getNestedProperty(template, 'courseTemplate.questions');
        return questions ? Object.values(questions) : [];
        
      case 'programTemplate':
        const programTemplate = this.getNestedProperty(template, 'programTemplate.template');
        return this.extractProgramQuestions(programTemplate) || [];
        
      case 'sectionTemplate':
        questions = this.getNestedProperty(template, 'sectionTemplate.questions');
        return questions ? Object.values(questions) : [];
        
      default:
        return [];
    }
  }

  extractProgramQuestions(templateArray) {
    if (!Array.isArray(templateArray)) return [];
    
    const questions = [];
    
    const extractFromChildren = (children) => {
      if (!Array.isArray(children)) return;
      
      children.forEach(child => {
        if (child.type === 'question' && child.id) {
          questions.push({
            id: child.id,
            type: child.type,
            config: child.config || {}
          });
        }
        
        if (child.children) {
          extractFromChildren(child.children);
        }
      });
    };
    
    templateArray.forEach(item => {
      if (item.children) {
        extractFromChildren(item.children);
      }
    });
    
    return questions;
  }

  getNestedProperty(obj, path) {
    return path.split('.').reduce((current, key) => current && current[key], obj);
  }

  compareQuestionsForSummary(mainQuestions, baselineQuestions) {
    const safeMainQuestions = Array.isArray(mainQuestions) ? mainQuestions : [];
    const safeBaselineQuestions = Array.isArray(baselineQuestions) ? baselineQuestions : [];
    
    const getKey = (q) => q.key || q.id || q.name || q.questionId || q.dataKey || 'unknown';
    const mainQuestionMap = new Map(safeMainQuestions.map(q => [getKey(q), q]));
    const baselineQuestionMap = new Map(safeBaselineQuestions.map(q => [getKey(q), q]));
    
    const allKeys = new Set([...mainQuestionMap.keys(), ...baselineQuestionMap.keys()]);
    
    let onlyInMain = 0;
    let onlyInBaseline = 0;
    let different = 0;
    
    allKeys.forEach(key => {
      const mainQ = mainQuestionMap.get(key);
      const baselineQ = baselineQuestionMap.get(key);
      
      if (mainQ && !baselineQ) {
        onlyInMain++;
      } else if (!mainQ && baselineQ) {
        onlyInBaseline++;
      } else if (mainQ && baselineQ) {
        if (JSON.stringify(mainQ) !== JSON.stringify(baselineQ)) {
          different++;
        }
      }
    });
    
    return {
      total: onlyInMain + onlyInBaseline + different,
      onlyInMain,
      onlyInBaseline,
      different
    };
  }

  compareQuestions(mainQuestions, baselineQuestions) {
    let comparison = '';
    
    const safeMainQuestions = Array.isArray(mainQuestions) ? mainQuestions : [];
    const safeBaselineQuestions = Array.isArray(baselineQuestions) ? baselineQuestions : [];
    
    const getKey = (q) => q.key || q.id || q.name || q.questionId || q.dataKey || 'unknown';
    const mainQuestionMap = new Map(safeMainQuestions.map(q => [getKey(q), q]));
    const baselineQuestionMap = new Map(safeBaselineQuestions.map(q => [getKey(q), q]));
    
    const allKeys = new Set([...mainQuestionMap.keys(), ...baselineQuestionMap.keys()]);
    
    comparison += `**Total Questions:** Main: ${safeMainQuestions.length}, Baseline: ${safeBaselineQuestions.length}\n\n`;
    
    if (safeMainQuestions.length === 0 && safeBaselineQuestions.length === 0) {
      return comparison + `*No questions found in either template*\n\n`;
    }
    
    const onlyInMain = [];
    const onlyInBaseline = [];
    const different = [];
    
    allKeys.forEach(key => {
      const mainQ = mainQuestionMap.get(key);
      const baselineQ = baselineQuestionMap.get(key);
      
      if (mainQ && !baselineQ) {
        onlyInMain.push(key);
      } else if (!mainQ && baselineQ) {
        onlyInBaseline.push(key);
      } else if (mainQ && baselineQ) {
        if (JSON.stringify(mainQ) !== JSON.stringify(baselineQ)) {
          different.push(key);
        }
      }
    });
    
    if (onlyInMain.length > 0) {
      comparison += `**Only in Main School (${onlyInMain.length}):** ${onlyInMain.join(', ')}\n\n`;
    }
    
    if (onlyInBaseline.length > 0) {
      comparison += `**Only in Baseline School (${onlyInBaseline.length}):** ${onlyInBaseline.join(', ')}\n\n`;
    }
    
    if (different.length > 0) {
      comparison += `**Different Configurations (${different.length}):** ${different.join(', ')}\n\n`;
    }
    
    if (onlyInMain.length === 0 && onlyInBaseline.length === 0 && different.length === 0) {
      comparison += `*✓ No differences found - configurations are identical*\n\n`;
    }
    
    return comparison;
  }

  getEnabledMergeTypes(mergeSettings) {
    return Object.values(mergeSettings)
      .filter(setting => setting && setting.enabled === true)
      .map(setting => ({
        type: setting.type,
        config: setting
      }));
  }

  compareMergeSettings(mainEnabled, baselineEnabled) {
    let comparison = '';
    
    const mainTypes = new Set(mainEnabled.map(m => m.type));
    const baselineTypes = new Set(baselineEnabled.map(m => m.type));
    
    const onlyInMain = [...mainTypes].filter(type => !baselineTypes.has(type));
    const onlyInBaseline = [...baselineTypes].filter(type => !mainTypes.has(type));
    const inBoth = [...mainTypes].filter(type => baselineTypes.has(type));
    
    comparison += `**Enabled Merge Types:** Main: ${mainEnabled.length}, Baseline: ${baselineEnabled.length}\n\n`;
    
    if (onlyInMain.length > 0) {
      comparison += `**Only enabled in Main School (${onlyInMain.length}):**\n`;
      onlyInMain.forEach(type => comparison += `- ${type}\n`);
      comparison += `\n`;
    }
    
    if (onlyInBaseline.length > 0) {
      comparison += `**Only enabled in Baseline School (${onlyInBaseline.length}):**\n`;
      onlyInBaseline.forEach(type => comparison += `- ${type}\n`);
      comparison += `\n`;
    }
    
    if (inBoth.length > 0) {
      comparison += `**Enabled in both schools:** ${inBoth.length} merge types\n\n`;
    }
    
    return comparison;
  }

  /**
   * ============================================================================
   * STEPS TO EXECUTE COMPARISON REPORT
   * ============================================================================
   * Compares stepsToExecute per enabled entity type between main and baseline schools
   */
  generateStepsToExecuteReport() {
    const mainMergeSettings = this.tempData['MainSchool_mergeSettings'];
    const baselineMergeSettings = this.tempData['BaselineSchool_mergeSettings'];
    
    if (!mainMergeSettings || !baselineMergeSettings || mainMergeSettings.error || baselineMergeSettings.error) {
      this.tempData['stepsToExecute_Comparison_Report'] = this.generateErrorReport('Steps To Execute', 'Merge settings data not available');
      return;
    }

    // Use new formatter-based entity selection logic
    const targetEntities = this.determineTargetEntities(mainMergeSettings, baselineMergeSettings);
    
    let report = `# Steps To Execute Comparison Report\n\n`;
    report += `**Main School:** ${this.mainSchool}\n`;
    report += `**Baseline School:** ${this.baselineSchool}\n`;
    report += `**Generated:** ${new Date().toLocaleString()}\n`;
    report += `**Environment:** https://staging.coursedog.com\n\n`;

    // Add information about entity selection method
    const mainFormatters = this.tempData['MainSchool_formatters'];
    const hasValidFormatters = mainFormatters && !mainFormatters.error;
    
    if (hasValidFormatters) {
      report += `**Entity Selection Method:** Based on main school formatter configuration (formatters=true)\n`;
    } else {
      report += `**Entity Selection Method:** Based on merge settings configuration (enabled=true)\n`;
    }
    report += `**Target Entities (${targetEntities.length}):** ${targetEntities.join(', ')}\n\n`;

    if (targetEntities.length === 0) {
      report += `*No target entities found for comparison*\n\n`;
      this.tempData['stepsToExecute_Comparison_Report'] = report;
      return;
    }

    // Table 1: List all target entities
    report += `##  Target Entities in ${this.mainSchool}\n\n`;
    report += `| Entity Type |\n`;
    report += `|-------------|\n`;
    targetEntities.forEach(entity => {
      report += `| ${entity} |\n`;
    });
    report += `\n---\n\n`;

    // Table 2: List the stepsToExecute grouped by entity (one section per entity)
    report += `##  \`stepsToExecute\` Comparison (by entity)\n\n`;

    const sectionsWithDiff = [];
    const sectionsNoDiff = [];

    targetEntities.forEach(entity => {
      const mainSteps = mainMergeSettings[entity]?.stepsToExecute;
      const baselineSteps = baselineMergeSettings[entity]?.stepsToExecute;

      let section = '';
      section += `### ${entity}\n\n`;

      // Build union of step keys using existing detection logic (no validation changes)
      const allKeys = new Set([...(mainSteps ? Object.keys(mainSteps) : []), ...(baselineSteps ? Object.keys(baselineSteps) : [])]);
      const sortedSteps = Array.from(allKeys).sort();

      // If no steps in either environment, show placeholder message only
      if ((!mainSteps && !baselineSteps) || sortedSteps.length === 0) {
        section += `*No differences identified.*\n\n`;
        sectionsNoDiff.push(section);
        return;
      }

      // Collect only rows that have differences
      const diffRows = [];
      sortedSteps.forEach(step => {
        const mainValue = mainSteps ? mainSteps[step] : undefined;
        const baselineValue = baselineSteps ? baselineSteps[step] : undefined;
        const isMatch = mainValue === baselineValue; // preserve validation semantics
        if (!isMatch) {
          const mainDisp = mainValue === undefined ? 'N/A' : mainValue;
          const baseDisp = baselineValue === undefined ? 'N/A' : baselineValue;
          diffRows.push(`| ${step} | \`${mainDisp}\` | \`${baseDisp}\` | ❌ |\n`);
        }
      });

      if (diffRows.length === 0) {
        // All lines match -> placeholder + message only
        section += `*No differences identified.*\n\n`;
        sectionsNoDiff.push(section);
      } else {
        // Only render the differing rows
        section += `| Step | ${this.formatSchoolHeader(this.mainSchool, this.mainEnv)} | ${this.formatSchoolHeader(this.baselineSchool, this.baselineEnv)} | Match |\n`;
        section += `|------|------------------|----------------|-------|\n`;
        diffRows.forEach(row => { section += row; });
        section += `\n`;
        sectionsWithDiff.push(section);
      }
    });

    // If no sections have differences at all, add a brief top-level note
    if (sectionsWithDiff.length === 0) {
      report += `*No differences identified across all Steps To Execute sections.*\n\n`;
    }

    // Render sections with differences at the top, followed by no-diff sections
    report += sectionsWithDiff.join('');
    report += sectionsNoDiff.join('');

    this.tempData['stepsToExecute_Comparison_Report'] = report;
  }

  /**
   * ============================================================================
   * FIELD EXCEPTIONS COMPARISON REPORT
   * ============================================================================
   * Compares fieldExceptions/conflictHandlingMethod per field per enabled entity type
   */
  generateFieldExceptionsReport() {
    const mainMergeSettings = this.tempData['MainSchool_mergeSettings'];
    const baselineMergeSettings = this.tempData['BaselineSchool_mergeSettings'];
    
    if (!mainMergeSettings || !baselineMergeSettings || mainMergeSettings.error || baselineMergeSettings.error) {
      this.tempData['fieldExceptions_Comparison_Report'] = this.generateErrorReport('Field Exceptions', 'Merge settings data not available');
      return;
    }

    // Use new formatter-based entity selection logic
    const targetEntities = this.determineTargetEntities(mainMergeSettings, baselineMergeSettings);
    
    let report = `# Field Exceptions Comparison Report\n\n`;
    report += `**Main School:** ${this.mainSchool}\n`;
    report += `**Baseline School:** ${this.baselineSchool}\n`;
    report += `**Generated:** ${new Date().toLocaleString()}\n`;
    report += `**Environment:** https://staging.coursedog.com\n\n`;

    // Add information about entity selection method
    const mainFormatters = this.tempData['MainSchool_formatters'];
    const hasValidFormatters = mainFormatters && !mainFormatters.error;
    
    if (hasValidFormatters) {
      report += `**Entity Selection Method:** Based on main school formatter configuration (formatters=true)\n`;
    } else {
      report += `**Entity Selection Method:** Based on merge settings configuration (enabled=true)\n`;
    }
    report += `**Target Entities (${targetEntities.length}):** ${targetEntities.join(', ')}\n\n`;

    if (targetEntities.length === 0) {
      report += `*No target entities found for comparison*\n\n`;
      this.tempData['fieldExceptions_Comparison_Report'] = report;
      return;
    }

    // Table 3: List the conflictHandlingMethod for each target entity (render only mismatches)
    report += `## Default \`conflictHandlingMethod\` Comparison\n\n`;
    const defaultMethodRows = [];
    targetEntities.forEach(entity => {
      const mainMethod = mainMergeSettings[entity]?.conflictHandlingMethod;
      const baselineMethod = baselineMergeSettings[entity]?.conflictHandlingMethod;
      const isMatch = mainMethod === baselineMethod;
      if (!isMatch) {
        defaultMethodRows.push(`| **${entity}** | \`${mainMethod || 'N/A'}\` | \`${baselineMethod || 'N/A'}\` | ❌ |\n`);
      }
    });
    if (defaultMethodRows.length === 0) {
      report += `No differences detected\n\n`;
    } else {
      report += `| Entity Type | ${this.formatSchoolHeader(this.mainSchool, this.mainEnv)} | ${this.formatSchoolHeader(this.baselineSchool, this.baselineEnv)} | Match |\n`;
      report += `|-------------|-------------------|-----------------|-------|\n`;
      defaultMethodRows.forEach(r => { report += r; });
      report += `\n`;
    }
    report += `---\n\n`;

    // Table 4: List the fieldExceptions for each field, grouped by entity type (one table per entity)
    report += `##  \`fieldExceptions\` Comparison (by entity)\n\n`;

    targetEntities.forEach(entity => {
      const mainExceptions = mainMergeSettings[entity]?.fieldExceptions || [];
      const baselineExceptions = baselineMergeSettings[entity]?.fieldExceptions || [];
      
      const allFields = {}; // Use path as key to store comparison data

      // Helper function to process exceptions
      const processExceptions = (exceptions, source) => {
        exceptions.forEach(exceptionGroup => {
          const method = exceptionGroup.conflictHandlingMethod;
          exceptionGroup.fields.forEach(field => {
            const path = field.path.join('.');
            if (!allFields[path]) {
              allFields[path] = {};
            }
            allFields[path][`${source}Method`] = method;
            allFields[path][`${source}Label`] = field.label;
          });
        });
      };

      processExceptions(mainExceptions, 'main');
      processExceptions(baselineExceptions, 'baseline');
      
      const sortedPaths = Object.keys(allFields).sort();

      // Per-entity subsection and table (render only mismatches)
      report += `### ${entity}\n\n`;
      if (sortedPaths.length === 0) {
        report += `No differences detected\n\n`;
        return;
      }

      const diffRows = [];
      sortedPaths.forEach(path => {
        const fieldData = allFields[path];
        const mainMethod = fieldData.mainMethod || '*Not Found*';
        const baselineMethod = fieldData.baselineMethod || '*Not Found*';
        const isMatch = mainMethod === baselineMethod;
        const displayName = fieldData.mainLabel || fieldData.baselineLabel || path;
        if (!isMatch) {
          diffRows.push(`| ${displayName} (\`${path}\`) | \`${mainMethod}\` | \`${baselineMethod}\` | ❌ |\n`);
        }
      });

      if (diffRows.length === 0) {
        report += `No differences detected\n\n`;
        return;
      }

      report += `| Field (Path) | ${this.formatSchoolHeader(this.mainSchool, this.mainEnv)} | ${this.formatSchoolHeader(this.baselineSchool, this.baselineEnv)} | Match |\n`;
      report += `|--------------|-----------------------------|---------------------------|-------|\n`;
      diffRows.forEach(r => { report += r; });
      report += `\n`;
    });

    this.tempData['fieldExceptions_Comparison_Report'] = report;
  }

  /**
   * ============================================================================
   * FIELD EXCEPTIONS COMPARISON REPORT (ENHANCED)
   * ============================================================================
   * Enhanced version using complete field exception maps from entityFieldExceptions API
   * This shows ALL fields (explicit + implicit) for accurate comparison
   * Falls back to basic version if field exception map data is not available
   */
  generateFieldExceptionsReportEnhanced() {
    const mainMergeSettings = this.tempData['MainSchool_mergeSettings'];
    const baselineMergeSettings = this.tempData['BaselineSchool_mergeSettings'];
    
    if (!mainMergeSettings || !baselineMergeSettings || mainMergeSettings.error || baselineMergeSettings.error) {
      this.tempData['fieldExceptions_Comparison_Report'] = this.generateErrorReport('Field Exceptions', 'Merge settings data not available');
      return;
    }

    const targetEntities = this.determineTargetEntities(mainMergeSettings, baselineMergeSettings);
    
    const mainEnvLabel = this.mainEnv === 'production' ? '🔴 Production' : '🧪 Staging';
    const baselineEnvLabel = this.baselineEnv === 'production' ? '🔴 Production' : '🧪 Staging';
    
    let report = `# Field Exceptions Comparison Report (Enhanced)\n\n`;
    report += `**Main School:** ${this.mainSchool} (${mainEnvLabel})\n`;
    report += `**Baseline School:** ${this.baselineSchool} (${baselineEnvLabel})\n`;
    report += `**Generated:** ${new Date().toLocaleString()}\n`;
    report += `**Data Source:** Complete field exception maps from entityFieldExceptions API\n\n`;

    // Add information about entity selection method
    const mainFormatters = this.tempData['MainSchool_formatters'];
    const hasValidFormatters = mainFormatters && !mainFormatters.error;
    
    if (hasValidFormatters) {
      report += `**Entity Selection Method:** Based on main school formatter configuration (formatters=true)\n`;
    } else {
      report += `**Entity Selection Method:** Based on merge settings configuration (enabled=true)\n`;
    }

    if (targetEntities.length === 0) {
      report += `*No target entities found for comparison*\n\n`;
      this.tempData['fieldExceptions_Comparison_Report'] = report;
      return;
    }

    report += `**Target Entities (${targetEntities.length}):** ${targetEntities.join(', ')}\n\n`;
    report += `---\n\n`;
    
    report += `## 📊 Summary [INFO_TOOLTIP]\n\n`;
    report += `**Purpose:** Compute and compare field exceptions per entity across selected environments.\n\n`;
    report += `### Workflow\n`;
    report += `Field exception comparison utilizes two API endpoints checked for both selected environments:\n\n`;
    report += `1. **GET /api/v1/{school}/integration/mergeSettings** - Returns configured merge settings for all entities\n`;
    report += `2. **POST /api/v1/{school}/integration/entityFieldExceptions/{entity}** - Returns computed field exceptions (combination of school's default, field exceptions, and global hardcoded exceptions)\n\n`;
    report += `### Important Requirements\n`;
    report += `- ⚠️ **Current Active Term** and **Current Scheduling Term** must be configured for the targeted school\n`;
    report += `- ⚠️ Sample data must exist for every entity type being compared\n`;
    report += `- ⚠️ When sample data doesn't exist, you'll see "No entityFieldExceptions record found" (these can be revealed using the show/hide button)\n`;
    report += `- ⚠️ When both schools fail to return entityFieldExceptions for an entity, comparison is based only on mergeSettings (may result in missing fields visible in CD UI)\n\n`;
    report += `---\n\n`;

    // Check if we have field exception map data
    let hasFieldExceptionData = false;
    for (const entity of targetEntities) {
      const mainMapData = this.tempData[`MainSchool_fieldExceptionMap_${entity}`];
      const baselineMapData = this.tempData[`BaselineSchool_fieldExceptionMap_${entity}`];
      if (mainMapData?.status === 'success' && baselineMapData?.status === 'success') {
        hasFieldExceptionData = true;
        break;
      }
    }

    if (!hasFieldExceptionData) {
      report += `⚠️ **Enhanced data not available** - Field exception maps were not fetched.\n`;
      report += `Falling back to basic comparison (explicit exceptions only).\n\n`;
      // Call the basic version instead
      this.generateFieldExceptionsReport();
      return;
    }

    // Process each entity
    targetEntities.forEach(entity => {
      const mainMapKey = `MainSchool_fieldExceptionMap_${entity}`;
      const baselineMapKey = `BaselineSchool_fieldExceptionMap_${entity}`;
      
      const mainMapData = this.tempData[mainMapKey];
      const baselineMapData = this.tempData[baselineMapKey];

      report += `## ${entity.charAt(0).toUpperCase() + entity.slice(1)}\n\n`;

      // Get default methods from merge settings
      const mainDefaultMethod = mainMergeSettings[entity]?.conflictHandlingMethod || 'N/A';
      const baselineDefaultMethod = baselineMergeSettings[entity]?.conflictHandlingMethod || 'N/A';

      // Get API availability status
      const mainApiAvailable = mainMapData?.apiAvailable !== false;
      const baselineApiAvailable = baselineMapData?.apiAvailable !== false;

      // Consolidated Comparison Summary
      report += `### 📊 Comparison Summary\n\n`;

      // Helper function to get entityFieldExceptions status
      const getEntityFieldExceptionsStatus = (mapData, apiAvailable) => {
        if (!apiAvailable) {
          return { icon: '❌', text: 'Failed', type: 'failed' };
        } else if (mapData?.isEmpty) {
          return { icon: '⚠️', text: 'Empty (no sample data)', type: 'empty' };
        } else {
          return { icon: '✅', text: 'Success', type: 'success' };
        }
      };

      // Get merge settings status (check if error property exists)
      const mainMergeSettingsSuccess = mainMergeSettings && !mainMergeSettings.error;
      const baselineMergeSettingsSuccess = baselineMergeSettings && !baselineMergeSettings.error;

      // Get entityFieldExceptions status
      const mainEntityStatus = getEntityFieldExceptionsStatus(mainMapData, mainApiAvailable);
      const baselineEntityStatus = getEntityFieldExceptionsStatus(baselineMapData, baselineApiAvailable);

      // Main School Summary (compact single-line format)
      report += `**Main School (${this.mainSchool}):** `;
      report += `mergeSettings: ${mainMergeSettingsSuccess ? '✅ Success' : '❌ Failed'}`;
      if (mainMergeSettingsSuccess) {
        report += ` • entityFieldExceptions: ${mainEntityStatus.icon} ${mainEntityStatus.text}`;
        report += ` • Default: \`${mainDefaultMethod}\``;
      } else {
        report += ` • entityFieldExceptions: Not attempted • Default: N/A`;
      }
      report += `\n\n`;

      // Baseline School Summary (compact single-line format)
      report += `**Baseline School (${this.baselineSchool}):** `;
      report += `mergeSettings: ${baselineMergeSettingsSuccess ? '✅ Success' : '❌ Failed'}`;
      if (baselineMergeSettingsSuccess) {
        report += ` • entityFieldExceptions: ${baselineEntityStatus.icon} ${baselineEntityStatus.text}`;
        report += ` • Default: \`${baselineDefaultMethod}\``;
      } else {
        report += ` • entityFieldExceptions: Not attempted • Default: N/A`;
      }
      report += `\n\n`;

      // Contextual notes based on API status
      const mainHasIssue = !mainMergeSettingsSuccess || mainEntityStatus.type !== 'success';
      const baselineHasIssue = !baselineMergeSettingsSuccess || baselineEntityStatus.type !== 'success';

      if (!mainMergeSettingsSuccess || !baselineMergeSettingsSuccess) {
        // If mergeSettings failed, this is critical
        report += `⚠️ **Cannot compare:** `;
        if (!mainMergeSettingsSuccess && !baselineMergeSettingsSuccess) {
          report += `Both schools' mergeSettings API failed. No comparison possible.\n\n`;
        } else if (!mainMergeSettingsSuccess) {
          report += `Main school's mergeSettings API failed. No field exception data available.\n\n`;
        } else {
          report += `Baseline school's mergeSettings API failed. No field exception data available.\n\n`;
        }
      } else if (mainHasIssue || baselineHasIssue) {
        // entityFieldExceptions issues
        report += `💡 **Note:** `;
        
        if (mainHasIssue && baselineHasIssue) {
          report += `Both schools have entityFieldExceptions API issues. Comparison limited to configured field exceptions only.\n\n`;
        } else {
          report += `Fields showing "No entityFieldExceptions record found" indicate the entityFieldExceptions API `;
          if (mainEntityStatus.type === 'empty' || baselineEntityStatus.type === 'empty') {
            report += `returned empty. `;
          } else {
            report += `failed. `;
          }
          report += `Use the hide/reveal toggle to focus on verifiable differences.\n\n`;
        }
      } else if (mainDefaultMethod !== baselineDefaultMethod) {
        // Both APIs succeeded but different defaults
        report += `⚠️ **Note:** Different default methods may cause all fields to mismatch.\n\n`;
      }

      report += `---\n\n`;

      // Check if data is available - only skip if BOTH schools have no usable data
      const mainHasData = mainMapData && (mainMapData.status === 'success' || mainMapData.status === 'empty-response' || mainMapData.status === 'api-failed') && mainMapData.data;
      const baselineHasData = baselineMapData && (baselineMapData.status === 'success' || baselineMapData.status === 'empty-response' || baselineMapData.status === 'api-failed') && baselineMapData.data;

      if (!mainHasData && !baselineHasData) {
        // BOTH schools have no data - cannot compare (already shown in summary above)
        return;
      }

      // Get the field maps - use empty object if one school's data is unavailable
      const mainMap = mainHasData ? mainMapData.data : {};
      const baselineMap = baselineHasData ? baselineMapData.data : {};
      
      // Get all unique field paths using unified field list (dynamic field discovery)
      // This ensures fields from API responses and configured exceptions are all included
      const unifiedFieldList = this.tempData[`unifiedFieldList_${entity}`];
      let allPaths;
      
      if (unifiedFieldList && unifiedFieldList.size > 0) {
        // Use the unified field list built from both schools' data
        allPaths = unifiedFieldList;
      } else {
        // Fallback: use fields from maps directly (shouldn't happen if buildUnifiedFieldLists ran)
        allPaths = new Set([...Object.keys(mainMap), ...Object.keys(baselineMap)]);
      }
      
      const sortedPaths = Array.from(allPaths).sort();

      // Build comparison table - show ALL fields with differences
      const diffRows = [];
      sortedPaths.forEach(path => {
        // Determine if field exists in each school
        const existsInMain = path in mainMap;
        const existsInBaseline = path in baselineMap;
        
        // Determine match status
        let isMatch;
        let matchStatus;
        let mainDisplay;
        let baselineDisplay;
        
        if (!existsInMain && !existsInBaseline) {
          // Field not in either map - likely in configured exceptions but not resolved
          // This can happen when both APIs fail and field is in one school's config only
          isMatch = false;
          matchStatus = '⚠️';
          
          // Check if field is in configured exceptions
          const mainConfigured = this.isFieldConfigured(path, mainMergeSettings[entity]);
          const baselineConfigured = this.isFieldConfigured(path, baselineMergeSettings[entity]);
          
          if (mainConfigured) {
            const mainResolution = this.resolveFieldException(path, entity, mainMergeSettings[entity]);
            mainDisplay = this.formatFieldExceptionDisplay(mainResolution);
          } else {
            // Differentiate between API failure/empty response vs normal "not configured"
            if (!mainApiAvailable || mainMapData?.isEmpty) {
              mainDisplay = 'No entityFieldExceptions record found';
            } else {
              mainDisplay = '_(not configured)_';
            }
          }
          
          if (baselineConfigured) {
            const baselineResolution = this.resolveFieldException(path, entity, baselineMergeSettings[entity]);
            baselineDisplay = this.formatFieldExceptionDisplay(baselineResolution);
          } else {
            // Differentiate between API failure/empty response vs normal "not configured"
            if (!baselineApiAvailable || baselineMapData?.isEmpty) {
              baselineDisplay = 'No entityFieldExceptions record found';
            } else {
              baselineDisplay = '_(not configured)_';
            }
          }
        } else if (!existsInMain) {
          // Only in baseline map
          isMatch = false;
          matchStatus = '⚠️';
          
          // Check if main has it configured even though not in map
          const mainConfigured = this.isFieldConfigured(path, mainMergeSettings[entity]);
          if (mainConfigured) {
            const mainResolution = this.resolveFieldException(path, entity, mainMergeSettings[entity]);
            mainDisplay = this.formatFieldExceptionDisplay(mainResolution);
          } else {
            // Differentiate between API failure/empty response vs normal "not configured"
            if (!mainApiAvailable || mainMapData?.isEmpty) {
              mainDisplay = 'No entityFieldExceptions record found';
            } else {
              mainDisplay = '_(not configured)_';
            }
          }
          
          const baselineResolution = this.resolveFieldException(path, entity, baselineMergeSettings[entity]);
          baselineDisplay = this.formatFieldExceptionDisplay(baselineResolution);
        } else if (!existsInBaseline) {
          // Only in main map
          isMatch = false;
          matchStatus = '⚠️';
          
          const mainResolution = this.resolveFieldException(path, entity, mainMergeSettings[entity]);
          mainDisplay = this.formatFieldExceptionDisplay(mainResolution);
          
          // Check if baseline has it configured even though not in map
          const baselineConfigured = this.isFieldConfigured(path, baselineMergeSettings[entity]);
          if (baselineConfigured) {
            const baselineResolution = this.resolveFieldException(path, entity, baselineMergeSettings[entity]);
            baselineDisplay = this.formatFieldExceptionDisplay(baselineResolution);
          } else {
            // Differentiate between API failure/empty response vs normal "not configured"
            if (!baselineApiAvailable || baselineMapData?.isEmpty) {
              baselineDisplay = 'No entityFieldExceptions record found';
            } else {
              baselineDisplay = '_(not configured)_';
            }
          }
        } else {
          // In both schools - compare values
          const mainResolution = this.resolveFieldException(path, entity, mainMergeSettings[entity]);
          const baselineResolution = this.resolveFieldException(path, entity, baselineMergeSettings[entity]);
          
          // Compare ONLY the actual field exception values, NOT the source
          isMatch = mainResolution.value === baselineResolution.value;
          matchStatus = isMatch ? '✓' : '❌';
          mainDisplay = this.formatFieldExceptionDisplay(mainResolution);
          baselineDisplay = this.formatFieldExceptionDisplay(baselineResolution);
        }
        
        // Final safety check: Extract and compare actual method values from display strings
        // This catches edge cases where display formatting differs but values are the same
        const extractMethodValue = (displayStr) => {
          // Handle special cases first
          if (displayStr === 'No entityFieldExceptions record found' || 
              displayStr === '_(not configured)_') {
            return displayStr;
          }
          
          // Extract method from formatted display like "⚙️ `alwaysCoursedog` (configured)"
          // Pattern: icon + backtick + method + backtick + optional (source)
          const match = displayStr.match(/`([^`]+)`/);
          return match ? match[1] : displayStr;
        };

        const mainMethodValue = extractMethodValue(mainDisplay);
        const baselineMethodValue = extractMethodValue(baselineDisplay);

        // If extracted values match, they're not a mismatch regardless of source
        if (mainMethodValue === baselineMethodValue) {
          isMatch = true;
          matchStatus = '✓';
        }
        
        // Only show mismatches (PRESERVE THIS BEHAVIOR)
        if (!isMatch) {
          // Check if row contains "No entityFieldExceptions record found"
          const hasNoEntityFieldExceptions = 
            mainDisplay.includes('No entityFieldExceptions record found') || 
            baselineDisplay.includes('No entityFieldExceptions record found');
          
          // Store row with metadata for hide/reveal feature
          diffRows.push({
            markdown: `| \`${path}\` | ${mainDisplay} | ${baselineDisplay} | ${matchStatus} |\n`,
            hasNoEntityFieldExceptions: hasNoEntityFieldExceptions
          });
        }
      });

      if (diffRows.length === 0) {
        report += `✅ **All ${sortedPaths.length} fields match** - No differences detected\n\n`;
      } else {
        // Check if ALL fields mismatch due to different defaults
        const allFieldsMismatch = diffRows.length === sortedPaths.length;
        const defaultsMatch = mainDefaultMethod === baselineDefaultMethod;
        
        if (!defaultsMatch && allFieldsMismatch) {
          // All mismatches are due to different default methods - show summary instead of table
          report += `⚠️ **All ${sortedPaths.length} fields differ due to different default conflict handling methods**\n\n`;
          report += `The schools use different default methods, causing all fields to have different exception values:\n`;
          report += `- **Main School default:** \`${mainDefaultMethod}\`\n`;
          report += `- **Baseline School default:** \`${baselineDefaultMethod}\`\n\n`;
          report += `💡 **Recommendation:** Align the default conflict handling methods between schools to resolve all ${sortedPaths.length} field differences.\n\n`;
        } else {
          // Some fields match or defaults are the same - show detailed table
          report += `| Field Path | ${this.formatSchoolHeader(this.mainSchool, this.mainEnv)} | ${this.formatSchoolHeader(this.baselineSchool, this.baselineEnv)} | Match |\n`;
          report += `|------------|---------------------------|---------------------------|-------|\n`;
          diffRows.forEach(row => { report += row.markdown; });
          report += `\n**Total Fields:** ${sortedPaths.length} • **Mismatches:** ${diffRows.length}\n\n`;
        }
      }
    });

    this.tempData['fieldExceptions_Comparison_Report'] = report;
  }

  /**
   * ============================================================================
   * COURSE TEMPLATE COMPARISON REPORT
   * ============================================================================
   * Compares courseTemplate questions between main and baseline schools
   */
  generateCourseTemplateReport() {
    const mainTemplate = this.tempData['MainSchool_courseTemplate'];
    const baselineTemplate = this.tempData['BaselineSchool_courseTemplate'];
    
    if (!mainTemplate || !baselineTemplate || mainTemplate.error || baselineTemplate.error) {
      this.tempData['courseTemplate_Comparison_Report'] = this.generateErrorReport('Course Template', 'Course template data not available');
      return;
    }

    let report = `# Course Template Comparison Report\n\n`;
    report += `**Main School:** ${this.mainSchool}\n`;
    report += `**Baseline School:** ${this.baselineSchool}\n`;
    report += `**Generated:** ${new Date().toLocaleString()}\n`;
    report += `**Environment:** https://staging.coursedog.com\n\n`;

    try {
      const mainQuestions = mainTemplate.courseTemplate?.questions || {};
      const baselineQuestions = baselineTemplate.courseTemplate?.questions || {};
      
      if (!mainQuestions || !baselineQuestions) {
        report += `*No course template questions found in either school*\n\n`;
        this.tempData['courseTemplate_Comparison_Report'] = report;
        return;
      }

      // New: Field existance check (comes before other tables)
      report += this.formatFieldExistanceTable(mainQuestions, baselineQuestions);

      report += this.compareCourseConfigurations(mainQuestions, baselineQuestions);
      
    } catch (error) {
      console.error('Error generating Course Template report:', error);
      report += `*Error generating course template comparison: ${error.message}*\n\n`;
    }

    this.tempData['courseTemplate_Comparison_Report'] = report;
  }

  /**
   * Extract nested field configurations from config.fields
   * @param {Object} question - Question object from the template
   * @returns {Object} Nested field configurations
   */
  extractNestedFieldConfigurations(question) {
    const nestedFields = question.config?.fields || {};
    const nestedConfigs = {};
    
    for (const [fieldId, fieldData] of Object.entries(nestedFields)) {
      nestedConfigs[fieldId] = this.extractConfigProperties(fieldData);
    }
    
    return nestedConfigs;
  }

  /**
   * Compare configurations between the two environments for course templates
   * @param {Object} mainQuestions - Questions from main school template
   * @param {Object} baselineQuestions - Questions from baseline template
   * @returns {Object} Comparison results and field categorization
   */
  compareCourseConfigurations(mainQuestions, baselineQuestions) {
    const comparisonResults = [];
    const nestedFieldResults = [];
    const baselineOnlyFields = [];
    const mainOnlyFields = [];
    const unchangedCommonFields = [];
    const allComparisonRows = [];
    const detailedResults = {
      required: [],
      dynamicOptions: [],
      config_default: [],
      config_useCourseOptions: [],
      actions: []
    };
    const nestedDetailedResults = {
      required: [],
      dynamicOptions: [],
      config_default: [],
      config_useCourseOptions: [],
      actions: []
    };
    
    // Get all question IDs from both environments
    const mainQuestionIds = new Set(Object.keys(mainQuestions));
    const baselineQuestionIds = new Set(Object.keys(baselineQuestions));
    
    for (const questionId of baselineQuestionIds) {
      if (!mainQuestionIds.has(questionId)) {
        baselineOnlyFields.push(questionId);
      }
    }
    
    for (const questionId of mainQuestionIds) {
      if (!baselineQuestionIds.has(questionId)) {
        mainOnlyFields.push(questionId);
      }
    }
    
    const fieldsToProcess = [...mainQuestionIds];
    
    for (const questionId of fieldsToProcess) {
      const mainConfig = this.extractConfigProperties(mainQuestions[questionId]);
      const baselineConfig = baselineQuestionIds.has(questionId) 
        ? this.extractConfigProperties(baselineQuestions[questionId]) 
        : null;
      
      const propertiesToCheck = ['required', 'dynamicOptions', 'config_default', 'config_useCourseOptions', 'actions'];
      let anyDifference = false;
      
      for (const propName of propertiesToCheck) {
        const mainValue = mainConfig[propName];
        const baselineValue = baselineConfig ? baselineConfig[propName] : null;
        
        const isDifferent = !this.deepEqual(mainValue, baselineValue);
        const isMainOnly = !baselineQuestionIds.has(questionId);
        
        if (isDifferent || isMainOnly) {
          anyDifference = true;
          const result = {
            field: questionId,
            property: propName,
            mainValue: this.valueToString(mainValue),
            baselineValue: baselineValue !== null ? this.valueToString(baselineValue) : 'Field not in baseline',
            fieldLabelMain: mainQuestions[questionId].label || '',
            fieldLabelBaseline: baselineConfig ? (baselineQuestions[questionId].label || '') : 'N/A',
            existsInBoth: !isMainOnly
          };
          
          comparisonResults.push(result);
          detailedResults[propName].push(result);
        }
      }

      // Track fields that exist in both templates and have no differences in tracked properties
      if (baselineQuestionIds.has(questionId) && !anyDifference) {
        unchangedCommonFields.push(questionId);
      }
      
      const mainNestedFields = this.extractNestedFieldConfigurations(mainQuestions[questionId]);
      const baselineNestedFields = baselineQuestionIds.has(questionId) 
        ? this.extractNestedFieldConfigurations(baselineQuestions[questionId]) 
        : {};
      
      const allNestedFieldIds = new Set([...Object.keys(mainNestedFields), ...Object.keys(baselineNestedFields)]);
      
      for (const nestedFieldId of allNestedFieldIds) {
        const mainNestedConfig = mainNestedFields[nestedFieldId] || {};
        const baselineNestedConfig = baselineNestedFields[nestedFieldId] || {};
        
        for (const propName of propertiesToCheck) {
          const mainValue = mainNestedConfig[propName];
          const baselineValue = baselineNestedConfig[propName];
          
          const isDifferent = !this.deepEqual(mainValue, baselineValue);
          const isMainOnly = !baselineQuestionIds.has(questionId) || !baselineNestedFields[nestedFieldId];
          
          if (isDifferent || (Object.keys(mainNestedConfig).length > 0 && isMainOnly)) {
            const mainNestedFieldData = mainQuestions[questionId].config?.fields?.[nestedFieldId] || {};
            const baselineNestedFieldData = baselineQuestionIds.has(questionId) 
              ? (baselineQuestions[questionId].config?.fields?.[nestedFieldId] || {})
              : {};
            
            const result = {
              parentField: questionId,
              nestedField: nestedFieldId,
              property: propName,
              mainValue: this.valueToString(mainValue),
              baselineValue: baselineValue !== null && baselineValue !== undefined ? this.valueToString(baselineValue) : 'Field not in baseline',
              parentFieldLabelMain: mainQuestions[questionId].label || '',
              parentFieldLabelBaseline: baselineQuestionIds.has(questionId) ? (baselineQuestions[questionId].label || '') : 'N/A',
              nestedFieldLabelMain: mainNestedFieldData.label || '',
              nestedFieldLabelBaseline: baselineNestedFieldData.label || '',
              existsInBoth: baselineQuestionIds.has(questionId)
            };
            
            nestedFieldResults.push(result);
            nestedDetailedResults[propName].push(result);
          }
        }
      }
    }

    // Build overall rows including all fields from both templates (visual Exists/Match)
    const propertiesToCheck = ['required', 'dynamicOptions', 'config_default', 'config_useCourseOptions', 'actions'];
    const allQuestionIds = new Set([...mainQuestionIds, ...baselineQuestionIds]);
    for (const questionId of allQuestionIds) {
      const mainExists = mainQuestionIds.has(questionId);
      const baselineExists = baselineQuestionIds.has(questionId);
      const mainConfig = mainExists ? this.extractConfigProperties(mainQuestions[questionId]) : null;
      const baselineConfig = baselineExists ? this.extractConfigProperties(baselineQuestions[questionId]) : null;
      for (const propName of propertiesToCheck) {
        const rawMainValue = mainConfig ? mainConfig[propName] : null;
        const rawBaselineValue = baselineConfig ? baselineConfig[propName] : null;
        const mainValue = mainExists ? this.valueToString(rawMainValue) : 'Field not in main';
        const baselineValue = baselineExists ? this.valueToString(rawBaselineValue) : 'Field not in baseline';
        const existsInBoth = mainExists && baselineExists;
        const match = existsInBoth && this.deepEqual(rawMainValue, rawBaselineValue);
        allComparisonRows.push({
          field: questionId,
          property: propName,
          mainValue,
          baselineValue,
          fieldLabelMain: mainExists ? (mainQuestions[questionId].label || '') : '',
          fieldLabelBaseline: baselineExists ? (baselineQuestions[questionId].label || '') : '',
          existsInBoth,
          match
        });
      }
    }
    
    return this.formatCourseComparisonReport(
      allComparisonRows,
      comparisonResults,
      nestedFieldResults,
      baselineOnlyFields,
      mainOnlyFields,
      unchangedCommonFields,
      detailedResults,
      nestedDetailedResults,
      mainQuestions,
      baselineQuestions
    );
  }

  /**
   * Format the course comparison results as a markdown report
   * @param {Array} comparisonResults - Array of comparison result objects
   * @param {Array} nestedFieldResults - Array of nested field comparison result objects
   * @param {Array} baselineOnlyFields - Fields only in baseline
   * @param {Array} mainOnlyFields - Fields only in main
   * @param {Object} detailedResults - Detailed results by property
   * @param {Object} nestedDetailedResults - Detailed nested field results by property
   * @param {Object} mainQuestions - Main school questions
   * @param {Object} baselineQuestions - Baseline school questions
   * @returns {string} Markdown report
   */
  formatCourseComparisonReport(allComparisonRows, comparisonResults, nestedFieldResults, baselineOnlyFields, mainOnlyFields, unchangedCommonFields, detailedResults, nestedDetailedResults, mainQuestions, baselineQuestions) {
    let report = '';
    
    report += `## Overall Configuration Differences\n`;
    report += `*This section lists all fields grouped by tracked property (required, dynamicOptions, config.default, config.useCourseOptions, actions). 'In Both?' indicates presence in both templates; 'Match' indicates identical values.*\n\n`;
    report += this.formatPropertyGroupedTables(allComparisonRows);
    report += '\n';
    
    report += `## Overall Nested Field Configuration Differences\n`;
    report += `*Note: This table shows all nested field configuration differences for questions with config.fields property*\n\n`;
    report += this.formatNestedFieldComparisonTable(nestedFieldResults);
    report += '\n';
    // Removed redundant per-property difference tables in favor of grouped property tables above
    
    // Removed detailed nested field property tables per request
    
    return report;
  }

  /**
   * Format the comparison results as a markdown table
   * @param {Array} comparisonResults - Array of comparison result objects
   * @returns {string} Markdown table
   */
  formatCourseComparisonTable(comparisonResults) {
    if (comparisonResults.length === 0) {
      return "No configuration differences found between the environments.";
    }
    
    let explanation = "*This table lists all fields and tracked properties (required, dynamicOptions, config.default, config.useCourseOptions, actions) from both templates. 'In Both?' indicates presence in both templates; 'Match' indicates identical values.*\n\n";
    let markdownTable = "| Field | Property | Field Label | Main School Value | Baseline School Value | In Both? | Match |\n";
    markdownTable += "|-------|----------|-------------|-------------------|----------------------|----------|-------|\n";
    
    const sortedRows = comparisonResults.slice().sort((a, b) => {
      const am = a.match ? 1 : 0;
      const bm = b.match ? 1 : 0;
      if (am !== bm) return am - bm; // ❌ (false) first
      const aLabel = (a.fieldLabelMain || a.fieldLabelBaseline || '').toString();
      const bLabel = (b.fieldLabelMain || b.fieldLabelBaseline || '').toString();
      const c1 = aLabel.localeCompare(bLabel);
      if (c1 !== 0) return c1;
      const c2 = String(a.field || '').localeCompare(String(b.field || ''));
      if (c2 !== 0) return c2;
      return String(a.property || '').localeCompare(String(b.property || ''));
    });
    for (const row of sortedRows) {
      const label = row.fieldLabelMain || row.fieldLabelBaseline;
      const existsIcon = row.existsInBoth ? "✅" : "❌";
      const matchIcon = row.match ? "✅" : "❌";
      markdownTable += `| ${row.field} | ${row.property} | ${label} | ${row.mainValue} | ${row.baselineValue} | ${existsIcon} | ${matchIcon} |\n`;
    }
    
    return explanation + markdownTable;
  }

  /**
   * Format nested field comparison results as a markdown table
   * @param {Array} nestedFieldResults - Array of nested field comparison result objects
   * @returns {string} Markdown table
   */
  formatNestedFieldComparisonTable(nestedFieldResults) {
    if (nestedFieldResults.length === 0) {
      return "No nested field configuration differences found between the environments.";
    }
    
    let explanation = "*This table lists nested fields (config.fields) and their tracked properties for questions present in at least one template. 'In Both?' indicates the parent and nested field exist in both templates.*\n\n";
    let markdownTable = "| Parent Field | Nested Field | Property | Parent Field Label | Nested Field Label | Main School Value | Baseline School Value | In Both? |\n";
    markdownTable += "|--------------|--------------|----------|-------------------|-------------------|-------------------|----------------------|----------|\n";
    
    for (const row of nestedFieldResults) {
      const parentLabel = row.parentFieldLabelMain || row.parentFieldLabelBaseline;
      const nestedLabel = row.nestedFieldLabelMain || row.nestedFieldLabelBaseline;
      const existsInBoth = row.existsInBoth ? "Yes" : "No";
      markdownTable += `| ${row.parentField} | ${row.nestedField} | ${row.property} | ${parentLabel} | ${nestedLabel} | ${row.mainValue} | ${row.baselineValue} | ${existsInBoth} |\n`;
    }
    
    return explanation + markdownTable;
  }

  /**
   * Determine if a property-grouped comparison row should be rendered
   * Rendering-only filter; does not change detection/validation logic
   * @param {Object} row - Row from allComparisonRows
   * @returns {boolean} True if the row should be included in the table
   */
  shouldRenderPropertyRow(row) {
    try {
      // Exclude rows where In Both? = ✅ and Match = ✅
      if (row && row.existsInBoth === true && row.match === true) {
        return false;
      }
      // Exclude rows where In Both? = ❌ and Match = ❌
      if (row && row.existsInBoth === false && row.match === false) {
        return false;
      }
      // Exclude rows where both sides are empty arrays: [] vs []
      if (row && row.mainValue === '[]' && row.baselineValue === '[]') {
        return false;
      }
      return true;
    } catch (e) {
      // If anything unexpected occurs, keep the row
      return true;
    }
  }

  // Render property-grouped tables from combined rows (shared by all template reports)
  formatPropertyGroupedTables(allComparisonRows) {
    if (!Array.isArray(allComparisonRows) || allComparisonRows.length === 0) {
      return 'No configuration differences found between the environments.';
    }
    const order = [
      { key: 'required', label: 'Required' },
      { key: 'dynamicOptions', label: 'Dynamic Options' },
      { key: 'config_default', label: 'Config Default' },
      { key: 'config_useCourseOptions', label: 'Config Use Course Options' },
      { key: 'actions', label: 'Actions' }
    ];
    const descMap = {
      'required': '*Compares question.required*',
      'dynamicOptions': '*Compares config.dynamicOptions*',
      'config_default': '*Compares config.default*',
      'config_useCourseOptions': '*Compares config.useCourseOptions*',
      'actions': '*Compares question.actions*'
    };
    let out = '';
    order.forEach(({ key, label }) => {
      const rows = allComparisonRows.filter(r => r.property === key);
      out += `### ${label} Differences\n`;
      out += `${descMap[key] || ''}\n`;
      const renderRows = rows.filter(r => this.shouldRenderPropertyRow(r));
      if (renderRows.length === 0) {
        out += `No differences detected\n\n`;
        return;
      }
      out += `| Field | Field Label | Main School Value | Baseline School Value | In Both? | Match |\n`;
      out += `|-------|-------------|-------------------|----------------------|----------|-------|\n`;
      const sortedRows = renderRows.slice().sort((a, b) => {
        const am = a.match ? 1 : 0;
        const bm = b.match ? 1 : 0;
        if (am !== bm) return am - bm; // ❌ (false) first
        const aLabel = (a.fieldLabelMain || a.fieldLabelBaseline || '').toString();
        const bLabel = (b.fieldLabelMain || b.fieldLabelBaseline || '').toString();
        const c1 = aLabel.localeCompare(bLabel);
        if (c1 !== 0) return c1;
        const c2 = String(a.field || '').localeCompare(String(b.field || ''));
        if (c2 !== 0) return c2;
        return String(a.property || '').localeCompare(String(b.property || ''));
      });
      sortedRows.forEach(row => {
        const labelText = row.fieldLabelMain || row.fieldLabelBaseline;
        const existsIcon = row.existsInBoth ? '✅' : '❌';
        const matchIcon = row.match ? '✅' : '❌';
        out += `| ${row.field} | ${labelText} | ${row.mainValue} | ${row.baselineValue} | ${existsIcon} | ${matchIcon} |\n`;
      });
      out += `\n`;
    });
    return out;
  }

  /**
   * Format detailed nested field results for a specific property
   * @param {Array} propertyResults - Array of nested field results for a specific property
   * @param {string} propertyName - Name of the property
   * @returns {string} Markdown table
   */
  formatDetailedNestedPropertyTable(propertyResults, propertyName) {
    if (propertyResults.length === 0) {
      return `No nested field differences found for ${propertyName}.`;
    }
    
    let explanation = `*This table includes nested fields (config.fields) for questions present in ${this.mainSchool} where '${propertyName}' differs from ${this.baselineSchool} or the nested field is missing in ${this.baselineSchool}. Baseline-only parents/nested fields are not shown here.*\n`;
    explanation += `*Analyzed JSON element: ${propertyName} (within config.fields)*\n\n`;
    let markdownTable = `| Parent Field | Nested Field | Parent Label | Nested Label | Main School Value | Baseline School Value | In Both? |\n`;
    markdownTable += `|--------------|--------------|--------------|--------------|-------------------|----------------------|----------|\n`;
    
    for (const row of propertyResults) {
      const parentLabel = row.parentFieldLabelMain || row.parentFieldLabelBaseline;
      const nestedLabel = row.nestedFieldLabelMain || row.nestedFieldLabelBaseline;
      const existsInBoth = row.existsInBoth ? "Yes" : "No";
      markdownTable += `| ${row.parentField} | ${row.nestedField} | ${parentLabel} | ${nestedLabel} | ${row.mainValue} | ${row.baselineValue} | ${existsInBoth} |\n`;
    }
    
    return explanation + markdownTable;
  }

  /**
   * ============================================================================
   * PROGRAM TEMPLATE COMPARISON REPORT
   * ============================================================================
   * Compares programTemplate questions between main and baseline schools
   */
  generateProgramTemplateReport() {
    const mainTemplate = this.tempData['MainSchool_programTemplate'];
    const baselineTemplate = this.tempData['BaselineSchool_programTemplate'];
    
    if (!mainTemplate || !baselineTemplate || mainTemplate.error || baselineTemplate.error) {
      this.tempData['programTemplate_Comparison_Report'] = this.generateErrorReport('Program Template', 'Program template data not available');
      return;
    }

    let report = `# Program Template Comparison Report\n\n`;
    report += `**Main School:** ${this.mainSchool}\n`;
    report += `**Baseline School:** ${this.baselineSchool}\n`;
    report += `**Generated:** ${new Date().toLocaleString()}\n`;
    report += `**Environment:** https://staging.coursedog.com\n\n`;

    try {
      const mainQuestions = mainTemplate.programTemplate?.questions || {};
      const baselineQuestions = baselineTemplate.programTemplate?.questions || {};
      
      if (!mainQuestions || !baselineQuestions) {
        report += `*No program template questions found in either school*\n\n`;
        this.tempData['programTemplate_Comparison_Report'] = report;
        return;
      }

      // New: Field existance check (comes before other tables)
      report += this.formatFieldExistanceTable(mainQuestions, baselineQuestions);

      report += this.compareProgramConfigurations(mainQuestions, baselineQuestions);
      
    } catch (error) {
      console.error('Error generating Program Template report:', error);
      report += `*Error generating program template comparison: ${error.message}*\n\n`;
    }

    this.tempData['programTemplate_Comparison_Report'] = report;
  }

  /**
   * Extract the specific configuration properties we're interested in
   * @param {Object} question - Question object from the template
   * @returns {Object} Extracted configuration properties
   */
  extractConfigProperties(question) {
    const config = question.config || {};
    
    return {
      required: question.required || false,
      dynamicOptions: config.dynamicOptions || {},
      config_default: config.default || null,
      config_useCourseOptions: config.useCourseOptions || null,
      actions: question.actions || []
    };
  }

  /**
   * Deep comparison of two values
   * @param {*} a - First value
   * @param {*} b - Second value
   * @returns {boolean} True if values are equal
   */
  deepEqual(a, b) {
    if (a === b) return true;
    
    if (a == null || b == null) return a === b;
    
    if (typeof a !== typeof b) return false;
    
    if (typeof a === 'object') {
      if (Array.isArray(a) !== Array.isArray(b)) return false;
      
      if (Array.isArray(a)) {
        if (a.length !== b.length) return false;
        return a.every((item, index) => this.deepEqual(item, b[index]));
      }
      
      const keysA = Object.keys(a);
      const keysB = Object.keys(b);
      
      if (keysA.length !== keysB.length) return false;
      
      return keysA.every(key => keysB.includes(key) && this.deepEqual(a[key], b[key]));
    }
    
    return false;
  }

  /**
   * Convert value to string for display
   * @param {*} value - Value to convert
   * @returns {string} String representation
   */
  valueToString(value) {
    if (value === null || value === undefined) return 'null';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  }

  /**
   * Format a field existence check table for two environments
   * @param {Object} mainQuestions - Questions object from main environment
   * @param {Object} baselineQuestions - Questions object from baseline environment
   * @returns {string} Markdown table placed before other tables
   */
  formatFieldExistanceTable(mainQuestions, baselineQuestions) {
    const mainIds = new Set(Object.keys(mainQuestions || {}));
    const baselineIds = new Set(Object.keys(baselineQuestions || {}));
    const allIds = new Set([...mainIds, ...baselineIds]);

    // Build rows and sort with "Found in both = false" first, then by field name
    const rows = Array.from(allIds).map(id => {
      const inMain = mainIds.has(id);
      const inBaseline = baselineIds.has(id);
      const both = inMain && inBaseline;
      return { id, inMain, inBaseline, both };
    }).sort((a, b) => {
      const aBoth = a.both ? 1 : 0;
      const bBoth = b.both ? 1 : 0;
      if (aBoth !== bBoth) return aBoth - bBoth; // false (0) first
      return String(a.id).localeCompare(String(b.id));
    });

    let out = '';
    out += `## Field existance check\n\n`;

    if (rows.length === 0) {
      out += `No fields found in either environment.\n\n`;
      return out;
    }

    out += `| Field Name | Exists in ${this.formatSchoolHeader(this.mainSchool, this.mainEnv)} | Exists in ${this.formatSchoolHeader(this.baselineSchool, this.baselineEnv)} | Found in both |\n`;
    out += `|------------|------------------------------|-------------------------------|----------------|\n`;
    rows.forEach(row => {
      out += `| ${row.id} | ${row.inMain ? '✅' : '❌'} | ${row.inBaseline ? '✅' : '❌'} | ${row.both ? '✅' : '❌'} |\n`;
    });
    out += `\n`;

    return out;
  }

  /**
   * Compare configurations between the two environments
   * @param {Object} mainQuestions - Questions from main school template
   * @param {Object} baselineQuestions - Questions from baseline template
   * @returns {Object} Comparison results and field categorization
   */
  compareProgramConfigurations(mainQuestions, baselineQuestions) {
    const comparisonResults = [];
    const baselineOnlyFields = [];
    const mainOnlyFields = [];
    const unchangedCommonFields = [];
    const allComparisonRows = [];
    const detailedResults = {
      required: [],
      dynamicOptions: [],
      config_default: [],
      config_useCourseOptions: [],
      actions: []
    };
    
    // Get all question IDs from both environments
    const mainQuestionIds = new Set(Object.keys(mainQuestions));
    const baselineQuestionIds = new Set(Object.keys(baselineQuestions));
    
    for (const questionId of baselineQuestionIds) {
      if (!mainQuestionIds.has(questionId)) {
        baselineOnlyFields.push(questionId);
      }
    }
    
    for (const questionId of mainQuestionIds) {
      if (!baselineQuestionIds.has(questionId)) {
        mainOnlyFields.push(questionId);
      }
    }
    
    const fieldsToProcess = [...mainQuestionIds];
    
    for (const questionId of fieldsToProcess) {
      const mainConfig = this.extractConfigProperties(mainQuestions[questionId]);
      const baselineConfig = baselineQuestionIds.has(questionId) 
        ? this.extractConfigProperties(baselineQuestions[questionId]) 
        : null;
      
      const propertiesToCheck = ['required', 'dynamicOptions', 'config_default', 'config_useCourseOptions', 'actions'];
      let anyDifference = false;
      
      for (const propName of propertiesToCheck) {
        const mainValue = mainConfig[propName];
        const baselineValue = baselineConfig ? baselineConfig[propName] : null;
        
        const isDifferent = !this.deepEqual(mainValue, baselineValue);
        const isMainOnly = !baselineQuestionIds.has(questionId);
        
        if (isDifferent || isMainOnly) {
          anyDifference = true;
          const result = {
            field: questionId,
            property: propName,
            mainValue: this.valueToString(mainValue),
            baselineValue: baselineValue !== null ? this.valueToString(baselineValue) : 'Field not in baseline',
            fieldLabelMain: mainQuestions[questionId].label || '',
            fieldLabelBaseline: baselineConfig ? (baselineQuestions[questionId].label || '') : 'N/A',
            existsInBoth: !isMainOnly
          };
          
          comparisonResults.push(result);
          detailedResults[propName].push(result);
        }
      }

      if (baselineQuestionIds.has(questionId) && !anyDifference) {
        unchangedCommonFields.push(questionId);
      }
    }

    // Build overall rows including all fields from both templates
    const propertiesToCheck = ['required', 'dynamicOptions', 'config_default', 'config_useCourseOptions', 'actions'];
    const allQuestionIds = new Set([...mainQuestionIds, ...baselineQuestionIds]);
    for (const questionId of allQuestionIds) {
      const mainExists = mainQuestionIds.has(questionId);
      const baselineExists = baselineQuestionIds.has(questionId);
      const mainConfig = mainExists ? this.extractConfigProperties(mainQuestions[questionId]) : null;
      const baselineConfig = baselineExists ? this.extractConfigProperties(baselineQuestions[questionId]) : null;
      for (const propName of propertiesToCheck) {
        const rawMainValue = mainConfig ? mainConfig[propName] : null;
        const rawBaselineValue = baselineConfig ? baselineConfig[propName] : null;
        const mainValue = mainExists ? this.valueToString(rawMainValue) : 'Field not in main';
        const baselineValue = baselineExists ? this.valueToString(rawBaselineValue) : 'Field not in baseline';
        const existsInBoth = mainExists && baselineExists;
        const match = existsInBoth && this.deepEqual(rawMainValue, rawBaselineValue);
        allComparisonRows.push({
          field: questionId,
          property: propName,
          mainValue,
          baselineValue,
          fieldLabelMain: mainExists ? (mainQuestions[questionId].label || '') : '',
          fieldLabelBaseline: baselineExists ? (baselineQuestions[questionId].label || '') : '',
          existsInBoth,
          match
        });
      }
    }

    return this.formatProgramComparisonReport(
      allComparisonRows,
      comparisonResults,
      baselineOnlyFields,
      mainOnlyFields,
      unchangedCommonFields,
      detailedResults,
      mainQuestions,
      baselineQuestions
    );
  }

  /**
   * Format the program comparison results as a markdown report
   * @param {Array} comparisonResults - Array of comparison result objects
   * @param {Array} baselineOnlyFields - Fields only in baseline
   * @param {Array} mainOnlyFields - Fields only in main
   * @param {Object} detailedResults - Detailed results by property
   * @param {Object} mainQuestions - Main school questions
   * @param {Object} baselineQuestions - Baseline school questions
   * @returns {string} Markdown report
   */
  formatProgramComparisonReport(allComparisonRows, comparisonResults, baselineOnlyFields, mainOnlyFields, unchangedCommonFields, detailedResults, mainQuestions, baselineQuestions) {
    let report = '';
    
    report += `## Overall Configuration Differences\n`;
    report += `*This section lists all fields grouped by tracked property (required, dynamicOptions, config.default, config.useCourseOptions, actions). 'In Both?' indicates presence in both templates; 'Match' indicates identical values.*\n\n`;
    report += this.formatPropertyGroupedTables(allComparisonRows);
    report += '\n';
    
    // Removed redundant per-property difference tables in favor of grouped property tables above
    
    return report;
  }

  /**
   * Format the comparison results as a markdown table
   * @param {Array} comparisonResults - Array of comparison result objects
   * @returns {string} Markdown table
   */
  formatProgramComparisonTable(comparisonResults) {
    if (comparisonResults.length === 0) {
      return "No configuration differences found between the environments.";
    }
    
    let explanation = "*This table lists all fields and tracked properties (required, dynamicOptions, config.default, config.useCourseOptions, actions) from both templates. 'In Both?' indicates presence in both templates; 'Match' indicates identical values.*\n\n";
    let markdownTable = "| Field | Property | Field Label | Main School Value | Baseline School Value | In Both? | Match |\n";
    markdownTable += "|-------|----------|-------------|-------------------|----------------------|----------|-------|\n";
    
    const sortedRows = comparisonResults.slice().sort((a, b) => {
      const am = a.match ? 1 : 0;
      const bm = b.match ? 1 : 0;
      if (am !== bm) return am - bm; // ❌ (false) first
      const aLabel = (a.fieldLabelMain || a.fieldLabelBaseline || '').toString();
      const bLabel = (b.fieldLabelMain || b.fieldLabelBaseline || '').toString();
      const c1 = aLabel.localeCompare(bLabel);
      if (c1 !== 0) return c1;
      const c2 = String(a.field || '').localeCompare(String(b.field || ''));
      if (c2 !== 0) return c2;
      return String(a.property || '').localeCompare(String(b.property || ''));
    });
    for (const row of sortedRows) {
      const label = row.fieldLabelMain || row.fieldLabelBaseline;
      const existsIcon = row.existsInBoth ? "✅" : "❌";
      const matchIcon = row.match ? "✅" : "❌";
      markdownTable += `| ${row.field} | ${row.property} | ${label} | ${row.mainValue} | ${row.baselineValue} | ${existsIcon} | ${matchIcon} |\n`;
    }
    
    return explanation + markdownTable;
  }

  /**
   * Format detailed results for a specific property
   * @param {Array} propertyResults - Array of results for a specific property
   * @param {string} propertyName - Name of the property
   * @returns {string} Markdown table
   */
  formatDetailedPropertyTable(propertyResults, propertyName) {
    if (propertyResults.length === 0) {
      return `No differences found for ${propertyName}.`;
    }
    
    let explanation = `*This table includes only fields present in ${this.mainSchool} where '${propertyName}' differs from ${this.baselineSchool} or the field is missing in ${this.baselineSchool}. Baseline-only fields are listed in a separate section.*\n`;
    explanation += `*Analyzed JSON element: ${propertyName}*\n\n`;
    let markdownTable = `| Field | Field Label | Main School Value | Baseline School Value | In Both? |\n`;
    markdownTable += `|-------|-------------|-------------------|----------------------|----------|\n`;
    
    for (const row of propertyResults) {
      const label = row.fieldLabelMain || row.fieldLabelBaseline;
      const existsInBoth = row.existsInBoth ? "Yes" : "No";
      markdownTable += `| ${row.field} | ${label} | ${row.mainValue} | ${row.baselineValue} | ${existsInBoth} |\n`;
    }
    
    return explanation + markdownTable;
  }

  /**
   * ============================================================================
   * SECTION TEMPLATE COMPARISON REPORT
   * ============================================================================
   * Compares sectionTemplate questions between main and baseline schools
   */
  generateSectionTemplateReport() {
    const mainTemplate = this.tempData['MainSchool_sectionTemplate'];
    const baselineTemplate = this.tempData['BaselineSchool_sectionTemplate'];
    
    if (!mainTemplate || !baselineTemplate || mainTemplate.error || baselineTemplate.error) {
      this.tempData['sectionTemplate_Comparison_Report'] = this.generateErrorReport('Section Template', 'Section template data not available');
      return;
    }

    let report = `# Section Template Comparison Report\n\n`;
    report += `**Main School:** ${this.mainSchool}\n`;
    report += `**Baseline School:** ${this.baselineSchool}\n`;
    report += `**Generated:** ${new Date().toLocaleString()}\n`;
    report += `**Environment:** https://staging.coursedog.com\n\n`;

    try {
      const mainQuestions = mainTemplate.sectionTemplate?.questions || {};
      const baselineQuestions = baselineTemplate.sectionTemplate?.questions || {};
      
      if (!mainQuestions || !baselineQuestions) {
        report += `*No section template questions found in either school*\n\n`;
        this.tempData['sectionTemplate_Comparison_Report'] = report;
        return;
      }

      // New: Field existance check (comes before other tables)
      report += this.formatFieldExistanceTable(mainQuestions, baselineQuestions);

      report += this.compareSectionConfigurations(mainQuestions, baselineQuestions);
      
    } catch (error) {
      console.error('Error generating Section Template report:', error);
      report += `*Error generating section template comparison: ${error.message}*\n\n`;
    }

    this.tempData['sectionTemplate_Comparison_Report'] = report;
  }

  /**
   * Compare configurations between the two environments for section templates
   * @param {Object} mainQuestions - Questions from main school template
   * @param {Object} baselineQuestions - Questions from baseline template
   * @returns {Object} Comparison results and field categorization
   */
  compareSectionConfigurations(mainQuestions, baselineQuestions) {
    const comparisonResults = [];
    const nestedFieldResults = [];
    const baselineOnlyFields = [];
    const mainOnlyFields = [];
    const unchangedCommonFields = [];
    const allComparisonRows = [];
    const detailedResults = {
      required: [],
      dynamicOptions: [],
      config_default: [],
      config_useCourseOptions: [],
      actions: []
    };
    const nestedDetailedResults = {
      required: [],
      dynamicOptions: [],
      config_default: [],
      config_useCourseOptions: [],
      actions: []
    };
    
    // Get all question IDs from both environments
    const mainQuestionIds = new Set(Object.keys(mainQuestions));
    const baselineQuestionIds = new Set(Object.keys(baselineQuestions));
    
    for (const questionId of baselineQuestionIds) {
      if (!mainQuestionIds.has(questionId)) {
        baselineOnlyFields.push(questionId);
      }
    }
    
    for (const questionId of mainQuestionIds) {
      if (!baselineQuestionIds.has(questionId)) {
        mainOnlyFields.push(questionId);
      }
    }
    
    const fieldsToProcess = [...mainQuestionIds];
    
    for (const questionId of fieldsToProcess) {
      const mainConfig = this.extractConfigProperties(mainQuestions[questionId]);
      const baselineConfig = baselineQuestionIds.has(questionId) 
        ? this.extractConfigProperties(baselineQuestions[questionId]) 
        : null;
      
      const propertiesToCheck = ['required', 'dynamicOptions', 'config_default', 'config_useCourseOptions', 'actions'];
      
      let anyDifference = false;
      for (const propName of propertiesToCheck) {
        const mainValue = mainConfig[propName];
        const baselineValue = baselineConfig ? baselineConfig[propName] : null;
        
        const isDifferent = !this.deepEqual(mainValue, baselineValue);
        const isMainOnly = !baselineQuestionIds.has(questionId);
        
        if (isDifferent || isMainOnly) {
          anyDifference = true;
          const result = {
            field: questionId,
            property: propName,
            mainValue: this.valueToString(mainValue),
            baselineValue: baselineValue !== null ? this.valueToString(baselineValue) : 'Field not in baseline',
            fieldLabelMain: mainQuestions[questionId].label || '',
            fieldLabelBaseline: baselineConfig ? (baselineQuestions[questionId].label || '') : 'N/A',
            existsInBoth: !isMainOnly
          };
          
          comparisonResults.push(result);
          detailedResults[propName].push(result);
        }
      }

      if (baselineQuestionIds.has(questionId) && !anyDifference) {
        unchangedCommonFields.push(questionId);
      }
      
      const mainNestedFields = this.extractNestedFieldConfigurations(mainQuestions[questionId]);
      const baselineNestedFields = baselineQuestionIds.has(questionId) 
        ? this.extractNestedFieldConfigurations(baselineQuestions[questionId]) 
        : {};
      
      const allNestedFieldIds = new Set([...Object.keys(mainNestedFields), ...Object.keys(baselineNestedFields)]);
      
      for (const nestedFieldId of allNestedFieldIds) {
        const mainNestedConfig = mainNestedFields[nestedFieldId] || {};
        const baselineNestedConfig = baselineNestedFields[nestedFieldId] || {};
        
        for (const propName of propertiesToCheck) {
          const mainValue = mainNestedConfig[propName];
          const baselineValue = baselineNestedConfig[propName];
          
          const isDifferent = !this.deepEqual(mainValue, baselineValue);
          const isMainOnly = !baselineQuestionIds.has(questionId) || !baselineNestedFields[nestedFieldId];
          
          if (isDifferent || (Object.keys(mainNestedConfig).length > 0 && isMainOnly)) {
            const mainNestedFieldData = mainQuestions[questionId].config?.fields?.[nestedFieldId] || {};
            const baselineNestedFieldData = baselineQuestionIds.has(questionId) 
              ? (baselineQuestions[questionId].config?.fields?.[nestedFieldId] || {})
              : {};
            
            const result = {
              parentField: questionId,
              nestedField: nestedFieldId,
              property: propName,
              mainValue: this.valueToString(mainValue),
              baselineValue: baselineValue !== null && baselineValue !== undefined ? this.valueToString(baselineValue) : 'Field not in baseline',
              parentFieldLabelMain: mainQuestions[questionId].label || '',
              parentFieldLabelBaseline: baselineQuestionIds.has(questionId) ? (baselineQuestions[questionId].label || '') : 'N/A',
              nestedFieldLabelMain: mainNestedFieldData.label || '',
              nestedFieldLabelBaseline: baselineNestedFieldData.label || '',
              existsInBoth: baselineQuestionIds.has(questionId)
            };
            
            nestedFieldResults.push(result);
            nestedDetailedResults[propName].push(result);
          }
        }
      }
    }

    // Build overall rows including all fields from both templates
    const propertiesToCheck = ['required', 'dynamicOptions', 'config_default', 'config_useCourseOptions', 'actions'];
    const allQuestionIds = new Set([...mainQuestionIds, ...baselineQuestionIds]);
    for (const questionId of allQuestionIds) {
      const mainExists = mainQuestionIds.has(questionId);
      const baselineExists = baselineQuestionIds.has(questionId);
      const mainConfig = mainExists ? this.extractConfigProperties(mainQuestions[questionId]) : null;
      const baselineConfig = baselineExists ? this.extractConfigProperties(baselineQuestions[questionId]) : null;
      for (const propName of propertiesToCheck) {
        const rawMainValue = mainConfig ? mainConfig[propName] : null;
        const rawBaselineValue = baselineConfig ? baselineConfig[propName] : null;
        const mainValue = mainExists ? this.valueToString(rawMainValue) : 'Field not in main';
        const baselineValue = baselineExists ? this.valueToString(rawBaselineValue) : 'Field not in baseline';
        const existsInBoth = mainExists && baselineExists;
        const match = existsInBoth && this.deepEqual(rawMainValue, rawBaselineValue);
        allComparisonRows.push({
          field: questionId,
          property: propName,
          mainValue,
          baselineValue,
          fieldLabelMain: mainExists ? (mainQuestions[questionId].label || '') : '',
          fieldLabelBaseline: baselineExists ? (baselineQuestions[questionId].label || '') : '',
          existsInBoth,
          match
        });
      }
    }
    
    return this.formatSectionComparisonReport(
      allComparisonRows,
      comparisonResults,
      nestedFieldResults,
      baselineOnlyFields,
      mainOnlyFields,
      unchangedCommonFields,
      detailedResults,
      nestedDetailedResults,
      mainQuestions,
      baselineQuestions
    );
  }

  /**
   * Format the section comparison results as a markdown report
   * @param {Array} comparisonResults - Array of comparison result objects
   * @param {Array} nestedFieldResults - Array of nested field comparison result objects
   * @param {Array} baselineOnlyFields - Fields only in baseline
   * @param {Array} mainOnlyFields - Fields only in main
   * @param {Object} detailedResults - Detailed results by property
   * @param {Object} nestedDetailedResults - Detailed nested field results by property
   * @param {Object} mainQuestions - Main school questions
   * @param {Object} baselineQuestions - Baseline school questions
   * @returns {string} Markdown report
   */
  formatSectionComparisonReport(allComparisonRows, comparisonResults, nestedFieldResults, baselineOnlyFields, mainOnlyFields, unchangedCommonFields, detailedResults, nestedDetailedResults, mainQuestions, baselineQuestions) {
    let report = '';
    
    report += `## Overall Configuration Differences\n`;
    report += `*This section lists all fields grouped by tracked property (required, dynamicOptions, config.default, config.useCourseOptions, actions). 'In Both?' indicates presence in both templates; 'Match' indicates identical values.*\n\n`;
    report += this.formatPropertyGroupedTables(allComparisonRows);
    report += '\n';
    
    report += `## Overall Nested Field Configuration Differences\n`;
    report += `*Note: This table shows all nested field configuration differences for questions with config.fields property*\n\n`;
    report += this.formatNestedFieldComparisonTable(nestedFieldResults);
    report += '\n';
    
    // Removed detailed nested field property tables per request
    
    return report;
  }

  /**
   * Format the comparison results as a markdown table
   * @param {Array} comparisonResults - Array of comparison result objects
   * @returns {string} Markdown table
   */
  formatSectionComparisonTable(comparisonResults) {
    if (comparisonResults.length === 0) {
      return "No configuration differences found between the environments.";
    }
    
    let explanation = "*This table lists all fields and tracked properties (required, dynamicOptions, config.default, config.useCourseOptions, actions) from both templates. 'In Both?' indicates presence in both templates; 'Match' indicates identical values.*\n\n";
    let markdownTable = "| Field | Property | Field Label | Main School Value | Baseline School Value | In Both? | Match |\n";
    markdownTable += "|-------|----------|-------------|-------------------|----------------------|----------|-------|\n";
    
    const sortedRows = comparisonResults.slice().sort((a, b) => {
      const am = a.match ? 1 : 0;
      const bm = b.match ? 1 : 0;
      if (am !== bm) return am - bm; // ❌ (false) first
      const aLabel = (a.fieldLabelMain || a.fieldLabelBaseline || '').toString();
      const bLabel = (b.fieldLabelMain || b.fieldLabelBaseline || '').toString();
      const c1 = aLabel.localeCompare(bLabel);
      if (c1 !== 0) return c1;
      const c2 = String(a.field || '').localeCompare(String(b.field || ''));
      if (c2 !== 0) return c2;
      return String(a.property || '').localeCompare(String(b.property || ''));
    });
    for (const row of sortedRows) {
      const label = row.fieldLabelMain || row.fieldLabelBaseline;
      const existsIcon = row.existsInBoth ? "✅" : "❌";
      const matchIcon = row.match ? "✅" : "❌";
      markdownTable += `| ${row.field} | ${row.property} | ${label} | ${row.mainValue} | ${row.baselineValue} | ${existsIcon} | ${matchIcon} |\n`;
    }
    
    return explanation + markdownTable;
  }

  /**
   * ============================================================================
   * HELPER METHODS FOR REPORT GENERATION
   * ============================================================================
   */

  generateErrorReport(reportType, errorMessage) {
    return `# ${reportType} Comparison Report\n\n**Error:** ${errorMessage}\n\n*This report could not be generated due to missing or invalid data.*\n`;
  }

  generateTemplateComparisonTable(mainQuestions, baselineQuestions, templateType) {
    const mainQuestionMap = new Map(mainQuestions.map(q => [q.key || q.id || q.name || 'unknown', q]));
    const baselineQuestionMap = new Map(baselineQuestions.map(q => [q.key || q.id || q.name || 'unknown', q]));
    
    const allKeys = new Set([...mainQuestionMap.keys(), ...baselineQuestionMap.keys()]);
    
    let report = `## ${templateType} Field Comparison\n\n`;
    report += `**Total Questions:** Main: ${mainQuestions.length}, Baseline: ${baselineQuestions.length}\n\n`;
    
    if (allKeys.size === 0) {
      return report + `*No questions found in either template*\n\n`;
    }

    // Fields only in baseline (to be included)
    const onlyInBaseline = [...allKeys].filter(key => !mainQuestionMap.has(key) && baselineQuestionMap.has(key));
    
    // Fields in both (to be compared)
    const commonFields = [...allKeys].filter(key => mainQuestionMap.has(key) && baselineQuestionMap.has(key));
    
    // Fields only in main (to be ignored)
    const onlyInMain = [...allKeys].filter(key => mainQuestionMap.has(key) && !baselineQuestionMap.has(key));

    if (onlyInBaseline.length > 0) {
      report += `### Fields Only in Baseline School\n\n`;
      report += `The following fields appear only in the baseline template:\n\n`;
      onlyInBaseline.forEach(field => {
        report += `- **${field}**\n`;
      });
      report += `\n`;
    }

    if (onlyInMain.length > 0) {
      report += `### Fields Only in Main School (Ignored)\n\n`;
      report += `The following fields appear only in the main school template and are ignored in this comparison:\n\n`;
      onlyInMain.forEach(field => {
        report += `- **${field}**\n`;
      });
      report += `\n`;
    }

    if (commonFields.length > 0) {
      report += `### Field Configuration Differences\n\n`;
      report += `| Field | Property | Main School | Baseline School |\n`;
      report += `|-------|----------|-------------|-----------------|\n`;
      
      commonFields.forEach(fieldKey => {
        const mainQ = mainQuestionMap.get(fieldKey);
        const baselineQ = baselineQuestionMap.get(fieldKey);
        
        const differences = this.compareQuestionConfigurations(mainQ, baselineQ);
        differences.forEach(diff => {
          report += `| ${fieldKey} | ${diff.property} | ${diff.mainValue} | ${diff.baselineValue} |\n`;
        });
      });
    }

    return report;
  }

  compareQuestionConfigurations(mainQ, baselineQ) {
    const differences = [];
    
    // Check required property
    if (mainQ.required !== baselineQ.required) {
      differences.push({
        property: 'Required',
        mainValue: mainQ.required ? 'Yes' : 'No',
        baselineValue: baselineQ.required ? 'Yes' : 'No'
      });
    }
    
    // Check dynamicOptions
    const mainDynamicOptions = mainQ.dynamicOptions ? JSON.stringify(mainQ.dynamicOptions) : 'Not set';
    const baselineDynamicOptions = baselineQ.dynamicOptions ? JSON.stringify(baselineQ.dynamicOptions) : 'Not set';
    if (mainDynamicOptions !== baselineDynamicOptions) {
      differences.push({
        property: 'Dynamic Options',
        mainValue: mainDynamicOptions,
        baselineValue: baselineDynamicOptions
      });
    }
    
    // Check config.default
    const mainDefault = mainQ.config?.default !== undefined ? JSON.stringify(mainQ.config.default) : 'Not set';
    const baselineDefault = baselineQ.config?.default !== undefined ? JSON.stringify(baselineQ.config.default) : 'Not set';
    if (mainDefault !== baselineDefault) {
      differences.push({
        property: 'Config Default',
        mainValue: mainDefault,
        baselineValue: baselineDefault
      });
    }
    
    // Check config.useCourseOptions
    if (mainQ.config?.useCourseOptions !== baselineQ.config?.useCourseOptions) {
      differences.push({
        property: 'Use Course Options',
        mainValue: mainQ.config?.useCourseOptions ? 'Yes' : 'No',
        baselineValue: baselineQ.config?.useCourseOptions ? 'Yes' : 'No'
      });
    }
    
    // Check actions
    const mainActions = mainQ.actions ? JSON.stringify(mainQ.actions) : 'Not set';
    const baselineActions = baselineQ.actions ? JSON.stringify(baselineQ.actions) : 'Not set';
    if (mainActions !== baselineActions) {
      differences.push({
        property: 'Actions',
        mainValue: mainActions,
        baselineValue: baselineActions
      });
    }
    
    return differences;
  }

  generateNestedFieldsComparison(questionsWithFields, baselineQuestions) {
    const baselineQuestionMap = new Map(baselineQuestions.map(q => [q.key || q.id || q.name || 'unknown', q]));
    
    let report = `| Question | Field | Property | Main School | Baseline School |\n`;
    report += `|----------|-------|----------|-------------|-----------------|\n`;
    
    questionsWithFields.forEach(question => {
      const baselineQ = baselineQuestionMap.get(question.key || question.id || question.name || 'unknown');
      
      if (question.config && question.config.fields) {
        Object.keys(question.config.fields).forEach(fieldKey => {
          const mainField = question.config.fields[fieldKey];
          const baselineField = baselineQ?.config?.fields?.[fieldKey];
          
          if (baselineField) {
            const differences = this.compareQuestionConfigurations(mainField, baselineField);
            differences.forEach(diff => {
              report += `| ${question.key || question.id || question.name} | ${fieldKey} | ${diff.property} | ${diff.mainValue} | ${diff.baselineValue} |\n`;
            });
          } else {
            report += `| ${question.key || question.id || question.name} | ${fieldKey} | Field not found | ${JSON.stringify(mainField)} | Not configured |\n`;
          }
        });
      }
    });
    
    return report;
  }

  /**
   * ============================================================================
   * ATTRIBUTE MAPPINGS COMPARISON REPORT
   * ============================================================================
   * Compares attributeMappings between main and baseline schools
   */
  generateAttributeMappingsReport() {
    const mainAttributeMappings = this.tempData['MainSchool_attributeMappings'];
    const baselineAttributeMappings = this.tempData['BaselineSchool_attributeMappings'];
    
    if (!mainAttributeMappings || !baselineAttributeMappings || mainAttributeMappings.error || baselineAttributeMappings.error) {
      this.tempData['AttributeMapping_Comparison_Report'] = this.generateErrorReport('Attribute Mappings', 'Attribute mappings data not available');
      return;
    }

    let report = `# Attribute Mappings Comparison Report\n\n`;
    report += `**Main School:** ${this.mainSchool}\n`;
    report += `**Baseline School:** ${this.baselineSchool}\n`;
    report += `**Generated:** ${new Date().toLocaleString()}\n`;
    report += `**Environment:** https://staging.coursedog.com\n\n`;

    // Use the improved comparison logic
    report += this.compareAttributeMappings(mainAttributeMappings, baselineAttributeMappings);

    this.tempData['AttributeMapping_Comparison_Report'] = report;
  }

  // Entity aliases for normalization
  getEntityAliases() {
    return {
      'campus': 'campuses',
      'campuses': 'campus',
      'degreeDesignation': 'degreeDesignations',
      'degreeDesignations': 'degreeDesignation'
    };
  }

  normalizeEntityKey(key) {
    return key.trim();
  }

  getCanonicalEntityKey(key) {
    const normalized = this.normalizeEntityKey(key);
    const aliases = this.getEntityAliases();
    return aliases[normalized] || normalized;
  }

  detectMappingFields(mappings = []) {
    const s = new Set();
    mappings.forEach(m => Object.keys(m || {}).forEach(k => s.add(k)));
    return Array.from(s).sort();
  }

  getCoreComparisonFields() {
    return ['code', 'description', 'status', 'primaryType', 'fieldName', 'types'];
  }

  mappingKey(mapping) {
    const sanitize = v => (v ?? '').toString().trim().toLowerCase();
    const core = [mapping?.code, mapping?.description, mapping?.fieldName, mapping?.primaryType]
      .map(sanitize).join('|');
    if (core !== '|||') return core;
    const id = mapping?.id ?? mapping?._id ?? '';
    return `id:${sanitize(id)}`;
  }

  areMappingsEqual(a = {}, b = {}) {
    const fields = this.getCoreComparisonFields();
    for (const f of fields) {
      if (f === 'types') {
        const ta = Array.isArray(a.types) ? [...a.types].sort() : [];
        const tb = Array.isArray(b.types) ? [...b.types].sort() : [];
        if (ta.length !== tb.length) return false;
        for (let i = 0; i < ta.length; i++) if (ta[i] !== tb[i]) return false;
      } else if ((a[f] ?? null) !== (b[f] ?? null)) {
        return false;
      }
    }
    return true;
  }

  truncateCell(s, max = 80) {
    const str = typeof s === 'string' ? s : JSON.stringify(s);
    if (!str) return 'N/A';
    return str.length > max ? str.slice(0, max - 3) + '...' : str;
  }

  addMappingTable(report, mappings, source, showAllFields = false) {
    if (!mappings?.length) { 
      report.push('No mappings found.\n'); 
      return; 
    }
    const detected = this.detectMappingFields(mappings);
    const display = showAllFields ? detected : ['code', 'description', 'primaryType', 'types', 'status'];
    report.push(`**${source} Mappings** (${mappings.length} total):\n`);
    report.push(`| ${display.map(h => h[0].toUpperCase() + h.slice(1)).join(' | ')} |`);
    report.push(`|${display.map(() => '------').join('|')}|`);
    const sorted = [...mappings].sort((a,b) => (a.code||'').localeCompare(b.code||'') ||
                                         (a.description||'').localeCompare(b.description||''));
    for (const m of sorted) {
      report.push(`| ${display.map(f => f === 'types'
        ? ((m.types?.length ? m.types.join(', ') : 'None'))
        : (m[f] ?? 'N/A')).join(' | ')} |`);
    }
    report.push('\n');
  }

  generateAttributeMappingStats(mainData, baselineData) {
    const mainEntityTypes = Object.keys(mainData).map(k => this.normalizeEntityKey(k));
    const baselineEntityTypes = Object.keys(baselineData).map(k => this.normalizeEntityKey(k));
    
    const commonEntityTypes = mainEntityTypes.filter(type => 
      baselineEntityTypes.includes(type) || baselineEntityTypes.includes(this.getCanonicalEntityKey(type))
    );
    const mainOnlyTypes = mainEntityTypes.filter(type => 
      !baselineEntityTypes.includes(type) && !baselineEntityTypes.includes(this.getCanonicalEntityKey(type))
    );
    const baselineOnlyTypes = baselineEntityTypes.filter(type => 
      !mainEntityTypes.includes(type) && !mainEntityTypes.includes(this.getCanonicalEntityKey(type))
    );
    
    let mainMappingCount = 0;
    let baselineMappingCount = 0;
    
    Object.keys(mainData).forEach(type => {
      mainMappingCount += mainData[type]?.data?.length || 0;
    });
    
    Object.keys(baselineData).forEach(type => {
      baselineMappingCount += baselineData[type]?.data?.length || 0;
    });

    const gatherFields = obj => {
      const s = new Set();
      Object.values(obj).forEach(e => (e?.data||[]).forEach(m => Object.keys(m).forEach(k => s.add(k))));
      return s;
    };
    const mainFields = gatherFields(mainData);
    const baseFields = gatherFields(baselineData);
    const commonFields = [...mainFields].filter(f => baseFields.has(f)).sort();
    const onlyMainFields = [...mainFields].filter(f => !baseFields.has(f)).sort();
    const onlyBaseFields = [...baseFields].filter(f => !mainFields.has(f)).sort();
    
    return {
      mainEntityCount: mainEntityTypes.length,
      baselineEntityCount: baselineEntityTypes.length,
      commonEntityCount: commonEntityTypes.length,
      mainOnlyCount: mainOnlyTypes.length,
      baselineOnlyCount: baselineOnlyTypes.length,
      mainMappingCount,
      baselineMappingCount,
      commonFields,
      onlyMainFields,
      onlyBaseFields
    };
  }

  compareAttributeMappings(mainData, baselineData) {
    const report = [];
    
    // Handle both array and object data structures for backward compatibility
    const processData = (data) => {
      if (Array.isArray(data)) {
        // Data is already an array (returnArray=true)
        return data;
      } else if (data && typeof data === 'object') {
        // Data is grouped by fieldName (groupedByFieldName=true) - legacy support
        const allMappings = [];
        Object.values(data).forEach(entity => {
          if (entity && entity.data && Array.isArray(entity.data)) {
            allMappings.push(...entity.data);
          }
        });
        return allMappings;
      }
      return [];
    };
    
    const mainMappings = processData(mainData);
    const baselineMappings = processData(baselineData);
    
    // Create a map of all unique fieldName values
    const fieldMap = new Map();
    
    // Process main school mappings
    mainMappings.forEach(mapping => {
      if (mapping && mapping.fieldName && mapping.primaryType) {
        const key = `${mapping.primaryType}|${mapping.fieldName}`;
        if (!fieldMap.has(key)) {
          fieldMap.set(key, {
            primaryType: mapping.primaryType,
            fieldName: mapping.fieldName,
            mainSchool: false,
            baseline: false
          });
        }
        fieldMap.get(key).mainSchool = true;
      }
    });
    
    // Process baseline mappings
    baselineMappings.forEach(mapping => {
      if (mapping && mapping.fieldName && mapping.primaryType) {
        const key = `${mapping.primaryType}|${mapping.fieldName}`;
        if (!fieldMap.has(key)) {
          fieldMap.set(key, {
            primaryType: mapping.primaryType,
            fieldName: mapping.fieldName,
            mainSchool: false,
            baseline: false
          });
        }
        fieldMap.get(key).baseline = true;
      }
    });
    
    // Group by primaryType
    const groupedByPrimaryType = new Map();
    for (const [key, data] of fieldMap) {
      const primaryType = data.primaryType;
      if (!groupedByPrimaryType.has(primaryType)) {
        groupedByPrimaryType.set(primaryType, []);
      }
      groupedByPrimaryType.get(primaryType).push(data);
    }
    
    // Generate report sections
    const sortedPrimaryTypes = Array.from(groupedByPrimaryType.keys()).sort();
    
    for (const primaryType of sortedPrimaryTypes) {
      report.push(`## ${primaryType}`);

      report.push(`| primaryType | fieldName | ${this.formatSchoolHeader(this.mainSchool, this.mainEnv)} | ${this.formatSchoolHeader(this.baselineSchool, this.baselineEnv)} |`);
      report.push('|-------------|-----------|------------|----------------|');
      
      const mappings = groupedByPrimaryType.get(primaryType);
      mappings.sort((a, b) => a.fieldName.localeCompare(b.fieldName));
      
      for (const mapping of mappings) {
        const mainStatus = mapping.mainSchool ? 'configured' : '-';
        const baselineStatus = mapping.baseline ? 'configured' : '-';
        
        report.push(`| ${mapping.primaryType} | ${mapping.fieldName} | ${mainStatus} | ${baselineStatus} |`);
      }
      
      report.push('\n');
    }
    
    report.push('---\n');
    report.push('*Report generated by Report Generator*\n');
    
    return report.join('\n');
  }

  /**
   * ============================================================================
   * INTEGRATION FILTERS COMPARISON REPORT
   * ============================================================================
   * Compares integrationFilters between main and baseline schools
   */
  generateIntegrationFiltersReport() {
    const mainIntegrationFilters = this.tempData['MainSchool_integrationFilters'];
    const baselineIntegrationFilters = this.tempData['BaselineSchool_integrationFilters'];
    
    if (!mainIntegrationFilters || !baselineIntegrationFilters || mainIntegrationFilters.error || baselineIntegrationFilters.error) {
      this.tempData['IntegrationFilters_Comparison_Report'] = this.generateErrorReport('Integration Filters', 'Integration filters data not available');
      return;
    }

    let report = `# Integration Filters Comparison Report\n\n`;
    report += `**Main School:** ${this.mainSchool}\n`;
    report += `**Baseline School:** ${this.baselineSchool}\n`;
    report += `**Generated:** ${new Date().toLocaleString()}\n`;
    report += `**Environment:** https://staging.coursedog.com\n\n`;

    // Use the improved comparison logic
    report += this.compareIntegrationFilters(mainIntegrationFilters, baselineIntegrationFilters);

    this.tempData['IntegrationFilters_Comparison_Report'] = report;
  }

  analyzeIntegrationFilterStructure(data) {
    if (!data || typeof data !== 'object') {
      return { type: 'invalid', structure: null };
    }
    
    if (data.error) {
      return { type: 'api_error', error: data.error };
    }
    
    if (Object.keys(data).length === 0) {
      return { type: 'empty', structure: null };
    }
    
    if (data.integrationFilters && typeof data.integrationFilters === 'object') {
      const entities = Object.keys(data.integrationFilters);
      return { type: 'structured', entities };
    }
    
    return { type: 'unknown', keys: Object.keys(data) };
  }

  extractFilterPath(filter) {
    const fv = filter?.filterValues?.[0]; 
    const p = fv?.key?.path;
    return Array.isArray(p) ? p.join('.') : 'unknown';
  }

  extractFilterLabel(filter) {
    const fv = filter?.filterValues?.[0];
    const label = fv?.key?.label;
    return label || 'N/A';
  }

  extractFilterValues(filter) {
    const fv = filter?.filterValues?.[0] || {};
    const v = Array.isArray(fv.values) ? fv.values.slice().sort() : [];
    const a = Array.isArray(fv.antiValues) ? fv.antiValues.slice().sort() : [];
    const vStr = v.length ? `values:[${v.join(', ')}]` : '';
    const aStr = a.length ? `antiValues:[${a.join(', ')}]` : '';
    return [vStr, aStr].filter(Boolean).join(', ') || 'no values';
  }

  normalizeFilterToKey(filter) {
    const type = filter?.filterType || 'unknown';
    const path = this.extractFilterPath(filter);
    const vals = this.extractFilterValues(filter);
    return `${type}|${path}|${vals}`;
  }

  addFilterTable(report, filters, source) {
    report.push(`**${source} Filters:**\n`);
    report.push('| Filter Type | Label | Path | Values | Anti-Values |');
    report.push('|-------------|-------|------|--------|-------------|');
    for (const f of (filters||[])) {
      const fv = f?.filterValues?.[0] || {};
      const type = f?.filterType || 'unknown';
      const label = this.extractFilterLabel(f);
      const path = this.extractFilterPath(f);
      const values = Array.isArray(fv.values) && fv.values.length ? fv.values.join(', ') : 'none';
      const anti = Array.isArray(fv.antiValues) && fv.antiValues.length ? fv.antiValues.join(', ') : 'none';
      report.push(`| ${type} | ${label} | ${path} | ${values} | ${anti} |`);
    }
    report.push('\n');
  }

  deepDiff(mainObj, baselineObj, basePath = '') {
    const differences = [];
    
    if (typeof mainObj !== typeof baselineObj) {
      differences.push({
        path: basePath || 'root',
        mainValue: JSON.stringify(mainObj),
        baselineValue: JSON.stringify(baselineObj),
        status: '❌ Different'
      });
      return differences;
    }
    
    if (mainObj === null || baselineObj === null) {
      if (mainObj !== baselineObj) {
        differences.push({
          path: basePath || 'root',
          mainValue: JSON.stringify(mainObj),
          baselineValue: JSON.stringify(baselineObj),
          status: mainObj === null ? '⚠️ Only in Baseline' : `⚠️ Only in ${this.mainSchool}`
        });
      }
      return differences;
    }
    
    if (typeof mainObj !== 'object') {
      if (mainObj !== baselineObj) {
        differences.push({
          path: basePath || 'root',
          mainValue: JSON.stringify(mainObj),
          baselineValue: JSON.stringify(baselineObj),
          status: '❌ Different'
        });
      } else {
        differences.push({
          path: basePath || 'root',
          mainValue: JSON.stringify(mainObj),
          baselineValue: JSON.stringify(baselineObj),
          status: '✅ Match'
        });
      }
      return differences;
    }
    
    const allKeys = new Set([...Object.keys(mainObj || {}), ...Object.keys(baselineObj || {})]);
    
    for (const key of allKeys) {
      const newPath = basePath ? `${basePath}.${key}` : key;
      const mainValue = mainObj?.[key];
      const baselineValue = baselineObj?.[key];
      
      if (mainValue === undefined && baselineValue !== undefined) {
        differences.push({
          path: newPath,
          mainValue: 'N/A',
          baselineValue: JSON.stringify(baselineValue).substring(0, 100),
          status: '⚠️ Only in Baseline'
        });
      } else if (mainValue !== undefined && baselineValue === undefined) {
        differences.push({
          path: newPath,
          mainValue: JSON.stringify(mainValue).substring(0, 100),
          baselineValue: 'N/A',
          status: `⚠️ Only in ${this.mainSchool}`
        });
      } else if (mainValue !== undefined && baselineValue !== undefined) {
        differences.push(...this.deepDiff(mainValue, baselineValue, newPath));
      }
    }
    
    return differences;
  }
  
  renderDeepDiffTable(diffRows) {
    if (diffRows.length === 0) {
      return ['No differences found.\n'];
    }
    
    const report = [];
    report.push(`| Path | ${this.formatSchoolHeader(this.mainSchool, this.mainEnv)} | ${this.formatSchoolHeader(this.baselineSchool, this.baselineEnv)} | Status |`);
    report.push('|------|------------|----------|--------|');
    
    const sortedRows = diffRows.slice().sort((a, b) => a.path.localeCompare(b.path));
    
    for (const row of sortedRows) {
      const truncatedMain = row.mainValue.length > 50 ? row.mainValue.substring(0, 47) + '...' : row.mainValue;
      const truncatedBaseline = row.baselineValue.length > 50 ? row.baselineValue.substring(0, 47) + '...' : row.baselineValue;
      
      report.push(`| ${row.path} | ${truncatedMain} | ${truncatedBaseline} | ${row.status} |`);
    }
    
    report.push('\n');
    return report;
  }

  compareIntegrationFilters(mainData, baselineData) {
    const report = [];

    const classify = d => {
      if (!d || typeof d !== 'object') return {type:'invalid'};
      if (d.error) return {type:'api_error', error:d.error};
      if (!Object.keys(d).length) return {type:'empty'};
      if (d.integrationFilters && typeof d.integrationFilters === 'object') {
        const entities = Object.keys(d.integrationFilters);
        return {type:'structured', entities};
      }
      return {type:'unknown', keys:Object.keys(d)};
    };

    const m = classify(mainData); 
    const b = classify(baselineData);

    if (m.type === 'api_error' || b.type === 'api_error') {
      report.push('## ⚠️ API Errors Detected\n');
      if (m.type === 'api_error') { 
        report.push(`**${this.mainSchool} Integration Filters Error:**`); 
        report.push('```'); 
        report.push(m.error); 
        report.push('```\n'); 
      }
      if (b.type === 'api_error') { 
        report.push('**Baseline Integration Filters Error:**'); 
        report.push('```'); 
        report.push(b.error); 
        report.push('```\n'); 
      }
      report.push('**Status**: ❌ Cannot perform comparison due to API errors\n'); 
      report.push('\n---\n*Report generated by Report Generator*\n'); 
      return report.join('\n');
    }

    if (m.type === 'structured' || b.type === 'structured') {
      const entityFieldCombinations = new Map();
      
      const extractFieldLabels = (data) => {
        const combinations = new Map();
        if (data?.integrationFilters) {
          Object.keys(data.integrationFilters).forEach(entityType => {
            const filters = data.integrationFilters[entityType] || [];
            filters.forEach(filter => {
              if (filter.filterValues && Array.isArray(filter.filterValues)) {
                filter.filterValues.forEach(filterValue => {
                  if (filterValue.key && filterValue.key.label) {
                    // Extract both label and path
                    const path = Array.isArray(filterValue.key.path) 
                      ? filterValue.key.path.join('.') 
                      : (filterValue.key.path || 'N/A');
                    const key = `${entityType}|${filterValue.key.label}|${path}`;
                    combinations.set(key, {
                      entityType,
                      fieldLabel: filterValue.key.label,
                      fieldPath: path
                    });
                  }
                });
              }
            });
          });
        }
        return combinations;
      };

      const mainCombinations = extractFieldLabels(mainData);
      const baselineCombinations = extractFieldLabels(baselineData);

      for (const [key, data] of mainCombinations) {
        if (!entityFieldCombinations.has(key)) {
          entityFieldCombinations.set(key, {
            entityType: data.entityType,
            fieldLabel: data.fieldLabel,
            fieldPath: data.fieldPath,
            mainSchool: false,
            baseline: false
          });
        }
        entityFieldCombinations.get(key).mainSchool = true;
      }

      for (const [key, data] of baselineCombinations) {
        if (!entityFieldCombinations.has(key)) {
          entityFieldCombinations.set(key, {
            entityType: data.entityType,
            fieldLabel: data.fieldLabel,
            fieldPath: data.fieldPath,
            mainSchool: false,
            baseline: false
          });
        }
        entityFieldCombinations.get(key).baseline = true;
      }

      const groupedByEntity = new Map();
      for (const [key, data] of entityFieldCombinations) {
        const entityType = data.entityType;
        if (!groupedByEntity.has(entityType)) {
          groupedByEntity.set(entityType, []);
        }
        groupedByEntity.get(entityType).push(data);
      }

      const sortedEntityTypes = Array.from(groupedByEntity.keys()).sort();

      for (const entityType of sortedEntityTypes) {
        report.push(`## ${entityType}\n`);
        report.push(`| entityType | Label | Path | ${this.formatSchoolHeader(this.mainSchool, this.mainEnv)} | ${this.formatSchoolHeader(this.baselineSchool, this.baselineEnv)} |`);
        report.push('|------------|-------|------|------------|----------------|');
        
        const fields = groupedByEntity.get(entityType);
        fields.sort((a, b) => a.fieldLabel.localeCompare(b.fieldLabel));
        
        for (const field of fields) {
          const mainStatus = field.mainSchool ? 'configured' : '-';
          const baselineStatus = field.baseline ? 'configured' : '-';
          
          report.push(`| ${field.entityType} | ${field.fieldLabel} | ${field.fieldPath} | ${mainStatus} | ${baselineStatus} |`);
        }
        
        report.push('\n');
      }

      report.push('---\n*Report generated by Report Generator*\n');
      return report.join('\n');
    }

    // If not structured and no API errors, omit structure analysis and deep diff; just note absence
    report.push('*No integration filters with mapped fields found.*\n');
    report.push('---\n*Report generated by Report Generator*\n');
    return report.join('\n');
  }

  /**
   * Detect if data is grouped by entity type or field name
   */
  detectDataStructure(mainData, baselineData) {
    // Check if the data structure suggests entity grouping
    // Look for common entity type patterns in the keys
    const entityPatterns = ['course', 'program', 'section', 'professor', 'student', 'term', 'room', 'building', 'department'];
    const mainKeys = Object.keys(mainData);
    const baselineKeys = Object.keys(baselineData);
    
    const hasEntityPatterns = [...mainKeys, ...baselineKeys].some(key => 
      entityPatterns.some(pattern => key.toLowerCase().includes(pattern))
    );
    
    // For attribute mappings, check if the structure has field names with data arrays
    const hasFieldDataStructure = [...mainKeys, ...baselineKeys].some(key => {
      const data = mainData[key] || baselineData[key];
      return data && typeof data === 'object' && data.data && Array.isArray(data.data);
    });
    
    return hasEntityPatterns && !hasFieldDataStructure;
  }

  /**
   * Generate attribute mappings report grouped by entity type
   */
  generateEntityGroupedAttributeMappingsReport(mainData, baselineData) {
    let report = '';
    
    // Group keys by entity type
    const entityGroups = this.groupKeysByEntityType([...Object.keys(mainData), ...Object.keys(baselineData)]);
    
    entityGroups.forEach(entityType => {
      report += `## ${entityType.charAt(0).toUpperCase() + entityType.slice(1)} Attribute Mappings\n\n`;
      
      const mainEntityData = mainData[entityType] || {};
      const baselineEntityData = baselineData[entityType] || {};
      
      report += this.generateAttributeMappingsComparisonTable(mainEntityData, baselineEntityData, entityType);
    });
    
    return report;
  }

  /**
   * Generate attribute mappings report grouped by field name
   */
  generateFieldGroupedAttributeMappingsReport(mainData, baselineData) {
    let report = '';
    
    report += `## Attribute Mappings Comparison\n\n`;
    
    // Group by primary type from the data arrays
    const primaryTypes = this.extractPrimaryTypesFromAttributeMappings(mainData, baselineData);
    
    if (primaryTypes.length === 0) {
      report += `*No attribute mappings found*\n\n`;
      return report;
    }
    
    primaryTypes.forEach(primaryType => {
      report += `### ${primaryType.charAt(0).toUpperCase() + primaryType.slice(1)} Attribute Mappings\n\n`;
      
      const mainFieldsForType = this.filterAttributeMappingsByPrimaryType(mainData, primaryType);
      const baselineFieldsForType = this.filterAttributeMappingsByPrimaryType(baselineData, primaryType);
      
      report += this.generateAttributeMappingsDetailedComparisonTable(mainFieldsForType, baselineFieldsForType, primaryType);
    });
    
    return report;
  }

  /**
   * Generate integration filters report grouped by entity type
   */
  generateEntityGroupedIntegrationFiltersReport(mainData, baselineData) {
    let report = '';
    
    // Group keys by entity type
    const entityGroups = this.groupKeysByEntityType([...Object.keys(mainData), ...Object.keys(baselineData)]);
    
    entityGroups.forEach(entityType => {
      report += `## ${entityType.charAt(0).toUpperCase() + entityType.slice(1)} Integration Filters\n\n`;
      
      const mainEntityData = mainData[entityType] || {};
      const baselineEntityData = baselineData[entityType] || {};
      
      report += this.generateIntegrationFiltersComparisonTable(mainEntityData, baselineEntityData, entityType);
    });
    
    return report;
  }

  /**
   * Generate integration filters report grouped by field name
   */
  generateFieldGroupedIntegrationFiltersReport(mainData, baselineData) {
    let report = '';
    
    report += `## Integration Filters Comparison\n\n`;
    report += this.generateIntegrationFiltersComparisonTable(mainData, baselineData, 'All Fields');
    
    return report;
  }

  /**
   * Group keys by entity type
   */
  groupKeysByEntityType(keys) {
    const entityTypes = new Set();
    
    keys.forEach(key => {
      // Try to extract entity type from key
      const entityPatterns = ['course', 'program', 'section', 'professor', 'student', 'term', 'room', 'building', 'department'];
      const foundEntity = entityPatterns.find(pattern => key.toLowerCase().includes(pattern));
      
      if (foundEntity) {
        entityTypes.add(foundEntity);
      } else {
        entityTypes.add('other');
      }
    });
    
    return Array.from(entityTypes).sort();
  }

  /**
   * Generate attribute mappings comparison table
   */
  generateAttributeMappingsComparisonTable(mainData, baselineData, entityType) {
    let report = '';
    
    const mainKeys = Object.keys(mainData);
    const baselineKeys = Object.keys(baselineData);
    const allKeys = new Set([...mainKeys, ...baselineKeys]);
    
    if (allKeys.size === 0) {
      report += `*No attribute mappings found for ${entityType}*\n\n`;
      return report;
    }
    
    report += `| Field Name | Main School Value | Baseline School Value | Match |\n`;
    report += `|------------|-------------------|----------------------|-------|\n`;
    
    const sortedKeys = Array.from(allKeys).sort();
    
    sortedKeys.forEach(fieldName => {
      const mainValue = mainData[fieldName];
      const baselineValue = baselineData[fieldName];
      
      const mainValueStr = mainValue !== undefined ? JSON.stringify(mainValue) : '*Not Found*';
      const baselineValueStr = baselineValue !== undefined ? JSON.stringify(baselineValue) : '*Not Found*';
      const isMatch = JSON.stringify(mainValue) === JSON.stringify(baselineValue);
      
      report += `| **${fieldName}** | \`${mainValueStr}\` | \`${baselineValueStr}\` | ${isMatch ? '✅' : '❌'} |\n`;
    });
    
    report += `\n`;
    return report;
  }

  /**
   * Generate integration filters comparison table
   */
  generateIntegrationFiltersComparisonTable(mainData, baselineData, entityType) {
    let report = '';
    
    const mainKeys = Object.keys(mainData);
    const baselineKeys = Object.keys(baselineData);
    const allKeys = new Set([...mainKeys, ...baselineKeys]);
    
    if (allKeys.size === 0) {
      report += `*No integration filters found for ${entityType}*\n\n`;
      return report;
    }
    
    report += `| Filter Name | Main School Value | Baseline School Value | Match |\n`;
    report += `|-------------|-------------------|----------------------|-------|\n`;
    
    const sortedKeys = Array.from(allKeys).sort();
    
    sortedKeys.forEach(filterName => {
      const mainValue = mainData[filterName];
      const baselineValue = baselineData[filterName];
      
      const mainValueStr = mainValue !== undefined ? JSON.stringify(mainValue) : '*Not Found*';
      const baselineValueStr = baselineValue !== undefined ? JSON.stringify(baselineValue) : '*Not Found*';
      const isMatch = JSON.stringify(mainValue) === JSON.stringify(baselineValue);
      
      report += `| **${filterName}** | \`${mainValueStr}\` | \`${baselineValueStr}\` | ${isMatch ? '✅' : '❌'} |\n`;
    });
    
    report += `\n`;
    return report;
  }

  /**
   * Extract primary types from attribute mappings data
   */
  extractPrimaryTypesFromAttributeMappings(mainData, baselineData) {
    const primaryTypes = new Set();
    
    // Extract from main data
    Object.values(mainData).forEach(fieldData => {
      if (fieldData && fieldData.data && Array.isArray(fieldData.data)) {
        fieldData.data.forEach(item => {
          if (item.primaryType) {
            primaryTypes.add(item.primaryType);
          }
        });
      }
    });
    
    // Extract from baseline data
    Object.values(baselineData).forEach(fieldData => {
      if (fieldData && fieldData.data && Array.isArray(fieldData.data)) {
        fieldData.data.forEach(item => {
          if (item.primaryType) {
            primaryTypes.add(item.primaryType);
          }
        });
      }
    });
    
    return Array.from(primaryTypes).sort();
  }

  /**
   * Filter attribute mappings by primary type
   */
  filterAttributeMappingsByPrimaryType(data, primaryType) {
    const filtered = {};
    
    Object.entries(data).forEach(([fieldName, fieldData]) => {
      if (fieldData && fieldData.data && Array.isArray(fieldData.data)) {
        const filteredData = fieldData.data.filter(item => item.primaryType === primaryType);
        if (filteredData.length > 0) {
          filtered[fieldName] = {
            ...fieldData,
            data: filteredData
          };
        }
      }
    });
    
    return filtered;
  }

  /**
   * Generate detailed attribute mappings comparison table
   */
  generateAttributeMappingsDetailedComparisonTable(mainData, baselineData, primaryType) {
    let report = '';
    
    const mainKeys = Object.keys(mainData);
    const baselineKeys = Object.keys(baselineData);
    const allKeys = new Set([...mainKeys, ...baselineKeys]);
    
    if (allKeys.size === 0) {
      report += `*No attribute mappings found for ${primaryType}*\n\n`;
      return report;
    }
    
    report += `| Field Name | Main School Count | Baseline School Count | Match |\n`;
    report += `|------------|-------------------|----------------------|-------|\n`;
    
    const sortedKeys = Array.from(allKeys).sort();
    
    sortedKeys.forEach(fieldName => {
      const mainFieldData = mainData[fieldName];
      const baselineFieldData = baselineData[fieldName];
      
      const mainCount = mainFieldData && mainFieldData.data ? mainFieldData.data.length : 0;
      const baselineCount = baselineFieldData && baselineFieldData.data ? baselineFieldData.data.length : 0;
      const isMatch = mainCount === baselineCount;
      
      report += `| **${fieldName}** | ${mainCount} | ${baselineCount} | ${isMatch ? '✅' : '❌'} |\n`;
    });
    
    report += `\n`;
    
    // Add detailed comparison for fields with differences
    const fieldsWithDifferences = sortedKeys.filter(fieldName => {
      const mainFieldData = mainData[fieldName];
      const baselineFieldData = baselineData[fieldName];
      const mainCount = mainFieldData && mainFieldData.data ? mainFieldData.data.length : 0;
      const baselineCount = baselineFieldData && baselineFieldData.data ? baselineFieldData.data.length : 0;
      return mainCount !== baselineCount || (mainFieldData && baselineFieldData && 
        JSON.stringify(mainFieldData.data) !== JSON.stringify(baselineFieldData.data));
    });
    
    if (fieldsWithDifferences.length > 0) {
      report += `### Detailed Field Differences\n\n`;
      
      fieldsWithDifferences.forEach(fieldName => {
        const mainFieldData = mainData[fieldName];
        const baselineFieldData = baselineData[fieldName];
        
        report += `#### ${fieldName}\n\n`;
        
        if (mainFieldData && mainFieldData.data) {
          report += `**Main School (${mainFieldData.data.length} entries):**\n`;
          mainFieldData.data.forEach((item, index) => {
            report += `${index + 1}. ${item.description || item.fieldName} (${item.code || item.id})\n`;
          });
          report += `\n`;
        }
        
        if (baselineFieldData && baselineFieldData.data) {
          report += `**Baseline School (${baselineFieldData.data.length} entries):**\n`;
          baselineFieldData.data.forEach((item, index) => {
            report += `${index + 1}. ${item.description || item.fieldName} (${item.code || item.id})\n`;
          });
          report += `\n`;
        }
      });
    }
    
    return report;
  }

  /**
   * Generate Notion API Debug Log Report
   * @param {Array} notionLogs - Array of Notion API request/response logs
   * @param {string} mainSchool - Main school ID
   * @param {string} baselineSchool - Baseline school ID
   * @returns {string} Markdown report
   */
  generateNotionDebugLog(notionLogs, mainSchool, baselineSchool) {
    if (!notionLogs || notionLogs.length === 0) {
      return `# Notion API Debug Log

## Summary
No Notion API calls were made during this session.

## Details
The Notion upload feature was not used for this report generation.

---
*Generated on ${new Date().toISOString()}*`;
    }

    const totalRequests = notionLogs.filter(log => log.type === 'request').length;
    const totalResponses = notionLogs.filter(log => log.type === 'response').length;
    const successfulRequests = notionLogs.filter(log => log.type === 'response' && log.status >= 200 && log.status < 300).length;
    const failedRequests = notionLogs.filter(log => log.type === 'response' && (log.status < 200 || log.status >= 300)).length;
    const rateLimitedRequests = notionLogs.filter(log => log.status === 429).length;

    let report = `# Notion API Debug Log

## Summary
- **Total Requests**: ${totalRequests}
- **Total Responses**: ${totalResponses}
- **Successful Requests**: ${successfulRequests}
- **Failed Requests**: ${failedRequests}
- **Rate Limited Requests**: ${rateLimitedRequests}
- **Success Rate**: ${totalResponses > 0 ? ((successfulRequests / totalResponses) * 100).toFixed(1) : 0}%

## Request/Response Details

`;

    // Group logs by request sequence
    const requestGroups = [];
    let currentGroup = null;

    for (const log of notionLogs) {
      if (log.type === 'request') {
        if (currentGroup) {
          requestGroups.push(currentGroup);
        }
        currentGroup = {
          request: log,
          responses: []
        };
      } else if (log.type === 'response' && currentGroup) {
        currentGroup.responses.push(log);
      }
    }

    if (currentGroup) {
      requestGroups.push(currentGroup);
    }

    // Generate detailed log for each request
    requestGroups.forEach((group, index) => {
      const request = group.request;
      const responses = group.responses;
      
      report += `### Request ${index + 1}: ${request.method} ${request.url.split('/').pop()}\n\n`;
      report += `**Timestamp**: ${request.timestamp}\n\n`;
      report += `**Method**: ${request.method}\n\n`;
      report += `**URL**: ${request.url}\n\n`;
      report += `**Headers**:\n\`\`\`json\n${JSON.stringify(request.headers, null, 2)}\n\`\`\`\n\n`;
      
      if (request.body) {
        report += `**Request Body**:\n\`\`\`json\n${JSON.stringify(request.body, null, 2)}\n\`\`\`\n\n`;
      }

      // Add response details
      responses.forEach((response, responseIndex) => {
        report += `#### Response ${responseIndex + 1}\n\n`;
        report += `**Timestamp**: ${response.timestamp}\n\n`;
        report += `**Status**: ${response.status}\n\n`;
        
        if (response.error) {
          report += `**Error**: ${response.error}\n\n`;
        }

        if (response.response) {
          // Truncate large responses for readability
          let responseStr = JSON.stringify(response.response, null, 2);
          if (responseStr.length > 5000) {
            responseStr = responseStr.substring(0, 5000) + '\n... [Response truncated for readability]';
          }
          report += `**Response Body**:\n\`\`\`json\n${responseStr}\n\`\`\`\n\n`;
        }
      });

      report += `---\n\n`;
    });

    report += `## Statistics

### Request Methods
`;

    const methodCounts = {};
    notionLogs.filter(log => log.type === 'request').forEach(log => {
      methodCounts[log.method] = (methodCounts[log.method] || 0) + 1;
    });

    Object.entries(methodCounts).forEach(([method, count]) => {
      report += `- **${method}**: ${count} requests\n`;
    });

    report += `\n### Response Status Codes
`;

    const statusCounts = {};
    notionLogs.filter(log => log.type === 'response').forEach(log => {
      statusCounts[log.status] = (statusCounts[log.status] || 0) + 1;
    });

    Object.entries(statusCounts).forEach(([status, count]) => {
      report += `- **${status}**: ${count} responses\n`;
    });

    report += `\n### Timeline
`;

    notionLogs.forEach((log, index) => {
      const time = new Date(log.timestamp).toLocaleTimeString();
      const type = log.type === 'request' ? '→' : '←';
      const method = log.method || '';
      const status = log.status ? ` (${log.status})` : '';
      const url = log.url ? log.url.split('/').pop() : '';
      
      report += `${index + 1}. ${time} ${type} ${method} ${url}${status}\n`;
    });

    report += `\n---
*Generated on ${new Date().toISOString()}*`;

    return report;
  }
}

// Make the class globally available
if (typeof window !== 'undefined') {
  window.CoursedogReportGenerator = CoursedogReportGenerator;
}
