/**
 * Repository layer for all database entities.
 *
 * Usage:
 *   import { createRepository } from './repository.js';
 *   const repo = createRepository(db);
 *
 * All methods map camelCase JS properties ↔ snake_case DB columns.
 * JSON fields (tech_stack, secondary_domains, skill_ids, applicable_stacks,
 * skills_suggested, config) are JSON.stringify'd on write and JSON.parse'd
 * on read.
 *
 * @param {import('better-sqlite3').Database} db
 */
export function createRepository(db) {
  // ── Helpers ──────────────────────────────────────────────────────────────────

  /** Parse a JSON string field; return [] or {} if null/undefined. */
  function parseJson(value, fallback = null) {
    if (value == null) return fallback;
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }

  /** Stringify a value for storage; return null if value is null/undefined. */
  function toJson(value) {
    if (value == null) return null;
    return JSON.stringify(value);
  }

  // ── Project ──────────────────────────────────────────────────────────────────

  /**
   * Map a raw DB row → JS Project object.
   */
  function rowToProject(row) {
    if (!row) return null;
    return {
      id: row.project_id,
      path: row.path,
      name: row.name,
      techStack: parseJson(row.tech_stack, []),
      gitRemote: row.git_remote ?? null,
      defaultBranch: row.default_branch ?? null,
      active: row.active === 1,
      lastScannedAt: row.last_scanned_at ?? null,
      stackHash: row.stack_hash ?? null,
      lastGardenedAt: row.last_gardened_at ?? null,
      gardenHealthScore: row.garden_health_score ?? null,
    };
  }

  const projectStmts = {
    insert: db.prepare(`
      INSERT INTO project (path, name, tech_stack, git_remote, default_branch)
      VALUES (@path, @name, @techStack, @gitRemote, @defaultBranch)
    `),
    getById: db.prepare(`SELECT * FROM project WHERE project_id = ?`),
    listAll: db.prepare(`SELECT * FROM project ORDER BY name`),
    listActive: db.prepare(`SELECT * FROM project WHERE active = 1 ORDER BY name`),
    update: db.prepare(`UPDATE project SET
      path = COALESCE(@path, path),
      name = COALESCE(@name, name),
      tech_stack = COALESCE(@techStack, tech_stack),
      git_remote = COALESCE(@gitRemote, git_remote),
      default_branch = COALESCE(@defaultBranch, default_branch),
      active = COALESCE(@active, active),
      last_scanned_at = COALESCE(@lastScannedAt, last_scanned_at),
      stack_hash = COALESCE(@stackHash, stack_hash),
      last_gardened_at = COALESCE(@lastGardenedAt, last_gardened_at),
      garden_health_score = COALESCE(@gardenHealthScore, garden_health_score)
      WHERE project_id = @id
    `),
    delete: db.prepare(`DELETE FROM project WHERE project_id = ?`),
  };

  /**
   * Create a new project.
   * @param {{ path: string, name: string, techStack?: any[], gitRemote?: string, defaultBranch?: string }} fields
   * @returns {number} project_id
   */
  function createProject({ path, name, techStack, gitRemote, defaultBranch }) {
    const result = projectStmts.insert.run({
      path,
      name,
      techStack: toJson(techStack ?? []),
      gitRemote: gitRemote ?? null,
      defaultBranch: defaultBranch ?? null,
    });
    return result.lastInsertRowid;
  }

  /**
   * @param {number} id
   * @returns {object|null}
   */
  function getProject(id) {
    return rowToProject(projectStmts.getById.get(id));
  }

  /**
   * @param {{ active?: boolean }} [opts]
   * @returns {object[]}
   */
  function listProjects({ active } = {}) {
    const rows =
      active === true ? projectStmts.listActive.all() : projectStmts.listAll.all();
    return rows.map(rowToProject);
  }

  /**
   * @param {number} id
   * @param {object} fields  Any subset of Project fields (camelCase).
   */
  function updateProject(id, fields) {
    const activeVal =
      fields.active !== undefined ? (fields.active ? 1 : 0) : null;
    projectStmts.update.run({
      id,
      path: fields.path ?? null,
      name: fields.name ?? null,
      techStack: fields.techStack !== undefined ? toJson(fields.techStack) : null,
      gitRemote: fields.gitRemote ?? null,
      defaultBranch: fields.defaultBranch ?? null,
      active: activeVal,
      lastScannedAt: fields.lastScannedAt ?? null,
      stackHash: fields.stackHash ?? null,
      lastGardenedAt: fields.lastGardenedAt ?? null,
      gardenHealthScore: fields.gardenHealthScore ?? null,
    });
  }

  /**
   * @param {number} id
   */
  function deleteProject(id) {
    projectStmts.delete.run(id);
  }

  // ── Persona ──────────────────────────────────────────────────────────────────

  function rowToPersona(row) {
    if (!row) return null;
    return {
      id: row.persona_id,
      label: row.label,
      domain: row.domain,
      secondaryDomains: parseJson(row.secondary_domains, []),
      characterSprite: row.character_sprite ?? null,
      skillIds: parseJson(row.skill_ids, []),
      systemPromptTemplate: row.system_prompt_template ?? null,
      source: row.source ?? null,
    };
  }

  const personaStmts = {
    insert: db.prepare(`
      INSERT INTO persona (label, domain, secondary_domains, character_sprite, skill_ids, system_prompt_template, source)
      VALUES (@label, @domain, @secondaryDomains, @characterSprite, @skillIds, @systemPromptTemplate, @source)
    `),
    getById: db.prepare(`SELECT * FROM persona WHERE persona_id = ?`),
    listAll: db.prepare(`SELECT * FROM persona ORDER BY label`),
  };

  /**
   * @param {{ label: string, domain: string, secondaryDomains?: any[], characterSprite?: string, skillIds?: any[], systemPromptTemplate?: string, source?: string }} fields
   * @returns {number} persona_id
   */
  function createPersona({
    label,
    domain,
    secondaryDomains,
    characterSprite,
    skillIds,
    systemPromptTemplate,
    source,
  }) {
    const result = personaStmts.insert.run({
      label,
      domain,
      secondaryDomains: toJson(secondaryDomains ?? []),
      characterSprite: characterSprite ?? null,
      skillIds: toJson(skillIds ?? []),
      systemPromptTemplate: systemPromptTemplate ?? null,
      source: source ?? null,
    });
    return result.lastInsertRowid;
  }

  /**
   * @param {number} id
   * @returns {object|null}
   */
  function getPersona(id) {
    return rowToPersona(personaStmts.getById.get(id));
  }

  /**
   * @returns {object[]}
   */
  function listPersonas() {
    return personaStmts.listAll.all().map(rowToPersona);
  }

  // ── Skill ────────────────────────────────────────────────────────────────────

  function rowToSkill(row) {
    if (!row) return null;
    return {
      id: row.skill_id,
      name: row.name,
      domain: row.domain,
      applicableStacks: parseJson(row.applicable_stacks, []),
      content: row.content,
      source: row.source,
      lastUsedAt: row.last_used_at ?? null,
    };
  }

  const skillStmts = {
    insert: db.prepare(`
      INSERT INTO skill (name, domain, applicable_stacks, content, source)
      VALUES (@name, @domain, @applicableStacks, @content, @source)
    `),
    getById: db.prepare(`SELECT * FROM skill WHERE skill_id = ?`),
    listAll: db.prepare(`SELECT * FROM skill ORDER BY name`),
  };

  /**
   * @param {{ name: string, domain: string, applicableStacks?: any[], content: string, source?: string }} fields
   * @returns {number} skill_id
   */
  function createSkill({ name, domain, applicableStacks, content, source }) {
    const result = skillStmts.insert.run({
      name,
      domain,
      applicableStacks: toJson(applicableStacks ?? []),
      content,
      source: source ?? 'built-in',
    });
    return result.lastInsertRowid;
  }

  /**
   * @param {number} id
   * @returns {object|null}
   */
  function getSkill(id) {
    return rowToSkill(skillStmts.getById.get(id));
  }

  /**
   * @returns {object[]}
   */
  function listSkills() {
    return skillStmts.listAll.all().map(rowToSkill);
  }

  // ── Memory ───────────────────────────────────────────────────────────────────

  function rowToMemory(row) {
    if (!row) return null;
    return {
      id: row.memory_id,
      projectId: row.project_id,
      domain: row.domain,
      type: row.type,
      content: row.content,
      status: row.status,
      confidenceScore: row.confidence_score,
      createdAt: row.created_at ?? null,
      lastVerifiedAt: row.last_verified_at ?? null,
      verificationCount: row.verification_count,
      stalenessSignal: row.staleness_signal ?? null,
      expiresAt: row.expires_at ?? null,
      sourcePersonaId: row.source_persona_id ?? null,
    };
  }

  const memoryStmts = {
    insert: db.prepare(`
      INSERT INTO memory (project_id, domain, type, content, source_persona_id)
      VALUES (@projectId, @domain, @type, @content, @sourcePersonaId)
    `),
    getById: db.prepare(`SELECT * FROM memory WHERE memory_id = ?`),
    listAll: db.prepare(`SELECT * FROM memory ORDER BY memory_id`),
    listByProject: db.prepare(`SELECT * FROM memory WHERE project_id = @projectId ORDER BY memory_id`),
    listByStatus: db.prepare(`SELECT * FROM memory WHERE status = @status ORDER BY memory_id`),
    listByProjectAndStatus: db.prepare(`
      SELECT * FROM memory WHERE project_id = @projectId AND status = @status ORDER BY memory_id
    `),
    update: db.prepare(`UPDATE memory SET
      status = COALESCE(@status, status),
      confidence_score = COALESCE(@confidenceScore, confidence_score),
      content = COALESCE(@content, content),
      last_verified_at = COALESCE(@lastVerifiedAt, last_verified_at),
      verification_count = COALESCE(@verificationCount, verification_count),
      staleness_signal = COALESCE(@stalenessSignal, staleness_signal),
      expires_at = COALESCE(@expiresAt, expires_at)
      WHERE memory_id = @id
    `),
  };

  /**
   * @param {{ projectId: number, domain: string, type: string, content: string, sourcePersonaId?: number }} fields
   * @returns {number} memory_id
   */
  function createMemory({ projectId, domain, type, content, sourcePersonaId }) {
    const result = memoryStmts.insert.run({
      projectId,
      domain,
      type,
      content,
      sourcePersonaId: sourcePersonaId ?? null,
    });
    return result.lastInsertRowid;
  }

  /**
   * @param {number} id
   * @returns {object|null}
   */
  function getMemory(id) {
    return rowToMemory(memoryStmts.getById.get(id));
  }

  /**
   * List memories with optional filters.
   * @param {{ projectId?: number, domains?: string[], status?: string }} [opts]
   * @returns {object[]}
   */
  function listMemories({ projectId, domains, status } = {}) {
    // Build dynamic query for domain IN clause support.
    let sql = 'SELECT * FROM memory WHERE 1=1';
    const params = {};

    if (projectId !== undefined) {
      sql += ' AND project_id = @projectId';
      params.projectId = projectId;
    }
    if (status !== undefined) {
      sql += ' AND status = @status';
      params.status = status;
    }
    if (domains && domains.length > 0) {
      // SQLite doesn't support array binding; use manual placeholders.
      const placeholders = domains.map((_, i) => `@domain${i}`).join(', ');
      sql += ` AND domain IN (${placeholders})`;
      domains.forEach((d, i) => {
        params[`domain${i}`] = d;
      });
    }

    sql += ' ORDER BY memory_id';

    return db.prepare(sql).all(params).map(rowToMemory);
  }

  /**
   * @param {number} id
   * @param {object} fields
   */
  function updateMemory(id, fields) {
    memoryStmts.update.run({
      id,
      status: fields.status ?? null,
      confidenceScore: fields.confidenceScore ?? null,
      content: fields.content ?? null,
      lastVerifiedAt: fields.lastVerifiedAt ?? null,
      verificationCount: fields.verificationCount ?? null,
      stalenessSignal: fields.stalenessSignal ?? null,
      expiresAt: fields.expiresAt ?? null,
    });
  }

  // ── Session ──────────────────────────────────────────────────────────────────

  function rowToSession(row) {
    if (!row) return null;
    return {
      id: row.session_id,
      projectId: row.project_id,
      personaId: row.persona_id,
      providerId: row.provider_id,
      startedAt: row.started_at ?? null,
      endedAt: row.ended_at ?? null,
      tokensIn: row.tokens_in,
      tokensOut: row.tokens_out,
      tokensCacheRead: row.tokens_cache_read,
      tokensCacheWrite: row.tokens_cache_write,
      commitsProduced: row.commits_produced,
      diffExists: row.diff_exists === 1,
      outcome: row.outcome,
      error: row.error ?? null,
    };
  }

  const sessionStmts = {
    insert: db.prepare(`
      INSERT INTO session (project_id, persona_id, provider_id)
      VALUES (@projectId, @personaId, @providerId)
    `),
    getById: db.prepare(`SELECT * FROM session WHERE session_id = ?`),
    update: db.prepare(`UPDATE session SET
      started_at = COALESCE(@startedAt, started_at),
      ended_at = COALESCE(@endedAt, ended_at),
      tokens_in = COALESCE(@tokensIn, tokens_in),
      tokens_out = COALESCE(@tokensOut, tokens_out),
      tokens_cache_read = COALESCE(@tokensCacheRead, tokens_cache_read),
      tokens_cache_write = COALESCE(@tokensCacheWrite, tokens_cache_write),
      commits_produced = COALESCE(@commitsProduced, commits_produced),
      diff_exists = COALESCE(@diffExists, diff_exists),
      outcome = COALESCE(@outcome, outcome),
      error = COALESCE(@error, error)
      WHERE session_id = @id
    `),
  };

  /**
   * @param {{ projectId: number, personaId: number, providerId?: string }} fields
   * @returns {number} session_id
   */
  function createSession({ projectId, personaId, providerId }) {
    const result = sessionStmts.insert.run({
      projectId,
      personaId,
      providerId: providerId ?? 'claude-code',
    });
    return result.lastInsertRowid;
  }

  /**
   * @param {number} id
   * @returns {object|null}
   */
  function getSession(id) {
    return rowToSession(sessionStmts.getById.get(id));
  }

  /**
   * @param {number} id
   * @param {object} fields
   */
  function updateSession(id, fields) {
    sessionStmts.update.run({
      id,
      startedAt: fields.startedAt ?? null,
      endedAt: fields.endedAt ?? null,
      tokensIn: fields.tokensIn ?? null,
      tokensOut: fields.tokensOut ?? null,
      tokensCacheRead: fields.tokensCacheRead ?? null,
      tokensCacheWrite: fields.tokensCacheWrite ?? null,
      commitsProduced: fields.commitsProduced ?? null,
      diffExists:
        fields.diffExists !== undefined ? (fields.diffExists ? 1 : 0) : null,
      outcome: fields.outcome ?? null,
      error: fields.error ?? null,
    });
  }

  // ── GardenLog ────────────────────────────────────────────────────────────────

  function rowToGardenLog(row) {
    if (!row) return null;
    return {
      id: row.garden_log_id,
      projectId: row.project_id,
      runAt: row.run_at,
      strategy: row.strategy ?? null,
      memoriesReviewed: row.memories_reviewed,
      memoriesUpdated: row.memories_updated,
      memoriesArchived: row.memories_archived,
      memoriesCreated: row.memories_created,
      skillsSuggested: parseJson(row.skills_suggested, []),
      claudeMdChanges: row.claude_md_changes ?? null,
      tokensUsed: row.tokens_used,
      budgetRemaining: row.budget_remaining,
      approved: row.approved,
      error: row.error ?? null,
    };
  }

  const gardenLogStmts = {
    insert: db.prepare(`
      INSERT INTO garden_log (
        project_id, run_at, strategy,
        memories_reviewed, memories_updated, memories_archived, memories_created,
        skills_suggested, claude_md_changes, tokens_used, budget_remaining,
        approved, error
      ) VALUES (
        @projectId, @runAt, @strategy,
        @memoriesReviewed, @memoriesUpdated, @memoriesArchived, @memoriesCreated,
        @skillsSuggested, @claudeMdChanges, @tokensUsed, @budgetRemaining,
        @approved, @error
      )
    `),
    getById: db.prepare(`SELECT * FROM garden_log WHERE garden_log_id = ?`),
  };

  /**
   * @param {object} entry  All fields for garden_log; projectId and runAt are required.
   * @returns {number} garden_log_id
   */
  function createGardenLog(entry) {
    const result = gardenLogStmts.insert.run({
      projectId: entry.projectId,
      runAt: entry.runAt ?? new Date().toISOString(),
      strategy: entry.strategy ?? null,
      memoriesReviewed: entry.memoriesReviewed ?? 0,
      memoriesUpdated: entry.memoriesUpdated ?? 0,
      memoriesArchived: entry.memoriesArchived ?? 0,
      memoriesCreated: entry.memoriesCreated ?? 0,
      skillsSuggested: toJson(entry.skillsSuggested ?? []),
      claudeMdChanges: entry.claudeMdChanges ?? null,
      tokensUsed: entry.tokensUsed ?? 0,
      budgetRemaining: entry.budgetRemaining ?? 0,
      approved: entry.approved ?? null,
      error: entry.error ?? null,
    });
    return result.lastInsertRowid;
  }

  /**
   * @param {number} id
   * @returns {object|null}
   */
  function getGardenLog(id) {
    return rowToGardenLog(gardenLogStmts.getById.get(id));
  }

  // ── GardenRule ───────────────────────────────────────────────────────────────

  function rowToGardenRule(row) {
    if (!row) return null;
    return {
      id: row.rule_id,
      scope: row.scope,
      projectId: row.project_id ?? null,
      schedule: row.schedule ?? null,
      strategy: row.strategy ?? null,
      config: parseJson(row.config, {}),
    };
  }

  const gardenRuleStmts = {
    insert: db.prepare(`
      INSERT INTO garden_rule (scope, project_id, schedule, strategy, config)
      VALUES (@scope, @projectId, @schedule, @strategy, @config)
    `),
    listAll: db.prepare(`SELECT * FROM garden_rule ORDER BY rule_id`),
  };

  /**
   * @param {{ scope: string, projectId?: number, schedule?: string, strategy?: string, config?: object }} fields
   * @returns {number} rule_id
   */
  function createGardenRule({ scope, projectId, schedule, strategy, config }) {
    const result = gardenRuleStmts.insert.run({
      scope: scope ?? 'global',
      projectId: projectId ?? null,
      schedule: schedule ?? null,
      strategy: strategy ?? null,
      config: toJson(config ?? {}),
    });
    return result.lastInsertRowid;
  }

  /**
   * @returns {object[]}
   */
  function listGardenRules() {
    return gardenRuleStmts.listAll.all().map(rowToGardenRule);
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  return {
    // Projects
    createProject,
    getProject,
    listProjects,
    updateProject,
    deleteProject,

    // Personas
    createPersona,
    getPersona,
    listPersonas,

    // Skills
    createSkill,
    getSkill,
    listSkills,

    // Memories
    createMemory,
    getMemory,
    listMemories,
    updateMemory,

    // Sessions
    createSession,
    getSession,
    updateSession,

    // GardenLogs
    createGardenLog,
    getGardenLog,

    // GardenRules
    createGardenRule,
    listGardenRules,
  };
}
