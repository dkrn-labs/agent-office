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
    getByPath: db.prepare(`SELECT * FROM project WHERE path = ?`),
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
   * @param {string} path
   * @returns {object|null}
   */
  function getProjectByPath(path) {
    return rowToProject(projectStmts.getByPath.get(path));
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
    update: db.prepare(`
      UPDATE persona SET
        label = COALESCE(@label, label),
        domain = COALESCE(@domain, domain),
        secondary_domains = COALESCE(@secondaryDomains, secondary_domains),
        character_sprite = COALESCE(@characterSprite, character_sprite),
        skill_ids = COALESCE(@skillIds, skill_ids),
        system_prompt_template = COALESCE(@systemPromptTemplate, system_prompt_template),
        source = COALESCE(@source, source)
      WHERE persona_id = @id
    `),
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

  /**
   * @param {number} id
   * @param {{ label?: string, domain?: string, secondaryDomains?: any[], characterSprite?: string, skillIds?: any[], systemPromptTemplate?: string, source?: string }} fields
   */
  function updatePersona(id, fields) {
    personaStmts.update.run({
      id,
      label: fields.label ?? null,
      domain: fields.domain ?? null,
      secondaryDomains: fields.secondaryDomains !== undefined ? toJson(fields.secondaryDomains) : null,
      characterSprite: fields.characterSprite ?? null,
      skillIds: fields.skillIds !== undefined ? toJson(fields.skillIds) : null,
      systemPromptTemplate: fields.systemPromptTemplate ?? null,
      source: fields.source ?? null,
    });
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
      providerSessionId: row.provider_session_id ?? null,
      systemPrompt: row.system_prompt ?? null,
      lastModel: row.last_model ?? null,
      tokensIn: row.tokens_in,
      tokensOut: row.tokens_out,
      tokensCacheRead: row.tokens_cache_read,
      tokensCacheWrite: row.tokens_cache_write,
      costUsd: row.cost_usd ?? null,
      commitsProduced: row.commits_produced,
      diffExists: row.diff_exists === 1,
      outcome: row.outcome,
      error: row.error ?? null,
    };
  }

  const sessionStmts = {
    insert: db.prepare(`
      INSERT INTO session (
        project_id, persona_id, provider_id, started_at, system_prompt
      )
      VALUES (
        @projectId, @personaId, @providerId, @startedAt, @systemPrompt
      )
    `),
    getById: db.prepare(`SELECT * FROM session WHERE session_id = ?`),
    getWithJoins: db.prepare(`
      SELECT
        s.*,
        p.name AS project_name,
        p.path AS project_path,
        pe.label AS persona_label,
        pe.domain AS persona_domain
      FROM session s
      JOIN project p ON p.project_id = s.project_id
      JOIN persona pe ON pe.persona_id = s.persona_id
      WHERE s.session_id = ?
    `),
    listActive: db.prepare(`
      SELECT
        s.*,
        p.name AS project_name,
        p.path AS project_path,
        pe.label AS persona_label,
        pe.domain AS persona_domain
      FROM session s
      JOIN project p ON p.project_id = s.project_id
      JOIN persona pe ON pe.persona_id = s.persona_id
      WHERE s.ended_at IS NULL
      ORDER BY COALESCE(s.started_at, '') DESC, s.session_id DESC
    `),
    update: db.prepare(`UPDATE session SET
      started_at = COALESCE(@startedAt, started_at),
      ended_at = COALESCE(@endedAt, ended_at),
      provider_session_id = COALESCE(@providerSessionId, provider_session_id),
      system_prompt = COALESCE(@systemPrompt, system_prompt),
      last_model = COALESCE(@lastModel, last_model),
      tokens_in = COALESCE(@tokensIn, tokens_in),
      tokens_out = COALESCE(@tokensOut, tokens_out),
      tokens_cache_read = COALESCE(@tokensCacheRead, tokens_cache_read),
      tokens_cache_write = COALESCE(@tokensCacheWrite, tokens_cache_write),
      cost_usd = COALESCE(@costUsd, cost_usd),
      commits_produced = COALESCE(@commitsProduced, commits_produced),
      diff_exists = COALESCE(@diffExists, diff_exists),
      outcome = COALESCE(@outcome, outcome),
      error = COALESCE(@error, error)
      WHERE session_id = @id
    `),
    countSince: db.prepare(`
      SELECT COUNT(*) AS count
      FROM session
      WHERE started_at IS NOT NULL AND started_at >= ?
    `),
    sumTokensSince: db.prepare(`
      SELECT COALESCE(SUM(tokens_in + tokens_out + tokens_cache_read + tokens_cache_write), 0) AS total
      FROM session
      WHERE started_at IS NOT NULL AND started_at >= ?
    `),
    sumCommitsSince: db.prepare(`
      SELECT COALESCE(SUM(commits_produced), 0) AS total
      FROM session
      WHERE ended_at IS NOT NULL AND ended_at >= ?
    `),
    pulseSince: db.prepare(`
      SELECT
        strftime('%Y-%m-%dT%H:00:00.000Z', COALESCE(ended_at, started_at)) AS hour_start,
        COALESCE(SUM(tokens_in + tokens_out + tokens_cache_read + tokens_cache_write), 0) AS tokens
      FROM session
      WHERE COALESCE(ended_at, started_at) IS NOT NULL
        AND COALESCE(ended_at, started_at) >= ?
      GROUP BY hour_start
      ORDER BY hour_start ASC
    `),
  };

  function buildSessionFilters({ personaId, projectId, outcome } = {}) {
    const clauses = [];
    const params = {};
    if (personaId != null) {
      clauses.push('s.persona_id = @personaId');
      params.personaId = Number(personaId);
    }
    if (projectId != null) {
      clauses.push('s.project_id = @projectId');
      params.projectId = Number(projectId);
    }
    if (outcome != null) {
      clauses.push('s.outcome = @outcome');
      params.outcome = String(outcome);
    }
    return {
      where: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '',
      params,
    };
  }

  function rowToSessionSummary(row) {
    if (!row) return null;
    const base = rowToSession(row);
    return {
      ...base,
      projectName: row.project_name ?? null,
      projectPath: row.project_path ?? null,
      personaLabel: row.persona_label ?? null,
      personaDomain: row.persona_domain ?? null,
      totalTokens:
        (base.tokensIn ?? 0) +
        (base.tokensOut ?? 0) +
        (base.tokensCacheRead ?? 0) +
        (base.tokensCacheWrite ?? 0),
      durationSec:
        base.startedAt && base.endedAt
          ? Math.max(
              0,
              Math.round(
                (new Date(base.endedAt).getTime() - new Date(base.startedAt).getTime()) / 1000,
              ),
            )
          : null,
    };
  }

  /**
   * @param {{ projectId: number, personaId: number, providerId?: string }} fields
   * @returns {number} session_id
   */
  function createSession({ projectId, personaId, providerId, startedAt, systemPrompt }) {
    const result = sessionStmts.insert.run({
      projectId,
      personaId,
      providerId: providerId ?? 'claude-code',
      startedAt: startedAt ?? new Date().toISOString(),
      systemPrompt: systemPrompt ?? null,
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
      providerSessionId: fields.providerSessionId ?? null,
      systemPrompt: fields.systemPrompt ?? null,
      lastModel: fields.lastModel ?? null,
      tokensIn: fields.tokensIn ?? null,
      tokensOut: fields.tokensOut ?? null,
      tokensCacheRead: fields.tokensCacheRead ?? null,
      tokensCacheWrite: fields.tokensCacheWrite ?? null,
      costUsd: fields.costUsd ?? null,
      commitsProduced: fields.commitsProduced ?? null,
      diffExists:
        fields.diffExists !== undefined ? (fields.diffExists ? 1 : 0) : null,
      outcome: fields.outcome ?? null,
      error: fields.error ?? null,
    });
  }

  function getSessionDetail(id) {
    return rowToSessionSummary(sessionStmts.getWithJoins.get(id));
  }

  function getActiveSessions() {
    return sessionStmts.listActive.all().map(rowToSessionSummary);
  }

  function listSessionsPage({ page = 1, pageSize = 20, personaId, projectId, outcome } = {}) {
    const safePage = Math.max(1, Number(page) || 1);
    const safePageSize = Math.min(100, Math.max(1, Number(pageSize) || 20));
    const offset = (safePage - 1) * safePageSize;
    const { where, params } = buildSessionFilters({ personaId, projectId, outcome });

    const totalItems = db.prepare(`
      SELECT COUNT(*) AS count
      FROM session s
      ${where}
    `).get(params).count;

    const items = db.prepare(`
      SELECT
        s.*,
        p.name AS project_name,
        p.path AS project_path,
        pe.label AS persona_label,
        pe.domain AS persona_domain
      FROM session s
      JOIN project p ON p.project_id = s.project_id
      JOIN persona pe ON pe.persona_id = s.persona_id
      ${where}
      ORDER BY COALESCE(s.ended_at, s.started_at) DESC, s.session_id DESC
      LIMIT @limit OFFSET @offset
    `)
      .all({ ...params, limit: safePageSize, offset })
      .map(rowToSessionSummary);

    return {
      page: safePage,
      pageSize: safePageSize,
      totalItems,
      totalPages: Math.max(1, Math.ceil(totalItems / safePageSize)),
      items,
    };
  }

  function countSessionsSince(isoTimestamp) {
    return sessionStmts.countSince.get(isoTimestamp).count;
  }

  function sumTokensSince(isoTimestamp) {
    return sessionStmts.sumTokensSince.get(isoTimestamp).total;
  }

  function sumCommitsSince(isoTimestamp) {
    return sessionStmts.sumCommitsSince.get(isoTimestamp).total;
  }

  function getPulseBucketsSince(isoTimestamp) {
    return sessionStmts.pulseSince.all(isoTimestamp).map((row) => ({
      hourStart: row.hour_start,
      tokens: row.tokens,
    }));
  }

  // ── Project History ─────────────────────────────────────────────────────────

  function rowToHistorySession(row) {
    if (!row) return null;
    return {
      id: row.history_session_id,
      projectId: row.project_id,
      personaId: row.persona_id ?? null,
      providerId: row.provider_id,
      providerSessionId: row.provider_session_id ?? null,
      startedAt: row.started_at ?? null,
      endedAt: row.ended_at ?? null,
      status: row.status,
      model: row.model ?? null,
      systemPrompt: row.system_prompt ?? null,
      source: row.source,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  function rowToHistorySummary(row) {
    if (!row) return null;
    return {
      id: row.history_summary_id,
      historySessionId: row.history_session_id,
      projectId: row.project_id,
      providerId: row.provider_id,
      summaryKind: row.summary_kind,
      request: row.request ?? null,
      investigated: row.investigated ?? null,
      learned: row.learned ?? null,
      completed: row.completed ?? null,
      nextSteps: row.next_steps ?? null,
      filesRead: parseJson(row.files_read, []),
      filesEdited: parseJson(row.files_edited, []),
      notes: row.notes ?? null,
      createdAt: row.created_at,
      createdAtEpoch: row.created_at_epoch,
    };
  }

  function rowToHistoryObservation(row) {
    if (!row) return null;
    return {
      id: row.history_observation_id,
      historySessionId: row.history_session_id,
      projectId: row.project_id,
      providerId: row.provider_id,
      type: row.type,
      title: row.title ?? null,
      subtitle: row.subtitle ?? null,
      narrative: row.narrative ?? null,
      facts: parseJson(row.facts, []),
      concepts: parseJson(row.concepts, []),
      filesRead: parseJson(row.files_read, []),
      filesModified: parseJson(row.files_modified, []),
      turnNumber: row.turn_number ?? null,
      contentHash: row.content_hash ?? null,
      generatedByModel: row.generated_by_model ?? null,
      relevanceCount: row.relevance_count,
      confidence: row.confidence,
      createdAt: row.created_at,
      createdAtEpoch: row.created_at_epoch,
      expiresAt: row.expires_at ?? null,
    };
  }

  const historySessionStmts = {
    insert: db.prepare(`
      INSERT INTO history_session (
        project_id, persona_id, provider_id, provider_session_id,
        started_at, ended_at, status, model, system_prompt, source, created_at, updated_at
      ) VALUES (
        @projectId, @personaId, @providerId, @providerSessionId,
        @startedAt, @endedAt, @status, @model, @systemPrompt, @source, @createdAt, @updatedAt
      )
    `),
    getById: db.prepare(`SELECT * FROM history_session WHERE history_session_id = ?`),
    getByProvider: db.prepare(`
      SELECT * FROM history_session
      WHERE provider_id = ? AND provider_session_id = ?
    `),
    update: db.prepare(`
      UPDATE history_session SET
        persona_id = COALESCE(@personaId, persona_id),
        provider_session_id = COALESCE(@providerSessionId, provider_session_id),
        started_at = COALESCE(@startedAt, started_at),
        ended_at = COALESCE(@endedAt, ended_at),
        status = COALESCE(@status, status),
        model = COALESCE(@model, model),
        system_prompt = COALESCE(@systemPrompt, system_prompt),
        source = COALESCE(@source, source),
        updated_at = @updatedAt
      WHERE history_session_id = @id
    `),
    drainStuck: db.prepare(`
      UPDATE history_session SET
        status = 'completed',
        ended_at = COALESCE(ended_at, datetime('now')),
        updated_at = datetime('now')
      WHERE status = 'in-progress'
        AND (
          started_at IS NULL
          OR julianday('now') - julianday(started_at) > @ageDays
        )
    `),
  };

  // ── launch_budget ──────────────────────────────────────────────────────
  const launchBudgetStmts = {
    upsert: db.prepare(`
      INSERT INTO launch_budget (
        history_session_id, provider_id, model,
        baseline_tokens, optimized_tokens,
        baseline_breakdown, optimized_breakdown,
        cost_dollars, cloud_equivalent_dollars,
        created_at_epoch
      ) VALUES (
        @historySessionId, @providerId, @model,
        @baselineTokens, @optimizedTokens,
        @baselineBreakdown, @optimizedBreakdown,
        @costDollars, @cloudEquivalentDollars,
        @createdAtEpoch
      )
      ON CONFLICT(history_session_id) DO UPDATE SET
        provider_id              = excluded.provider_id,
        model                    = COALESCE(excluded.model, launch_budget.model),
        baseline_tokens          = excluded.baseline_tokens,
        optimized_tokens         = excluded.optimized_tokens,
        baseline_breakdown       = excluded.baseline_breakdown,
        optimized_breakdown      = excluded.optimized_breakdown,
        cost_dollars             = COALESCE(excluded.cost_dollars, launch_budget.cost_dollars),
        cloud_equivalent_dollars = COALESCE(excluded.cloud_equivalent_dollars, launch_budget.cloud_equivalent_dollars)
    `),
    setOutcome: db.prepare(`
      UPDATE launch_budget SET outcome = @outcome WHERE history_session_id = @historySessionId
    `),
    listSince: db.prepare(`
      SELECT history_session_id, provider_id, model,
             baseline_tokens, optimized_tokens,
             baseline_breakdown, optimized_breakdown,
             outcome, cost_dollars, cloud_equivalent_dollars, created_at_epoch
        FROM launch_budget
       WHERE created_at_epoch >= @since
       ORDER BY created_at_epoch DESC
    `),
  };

  function rowToLaunchBudget(row) {
    if (!row) return null;
    return {
      historySessionId: row.history_session_id,
      providerId: row.provider_id,
      model: row.model ?? null,
      baselineTokens: row.baseline_tokens ?? 0,
      optimizedTokens: row.optimized_tokens ?? 0,
      baselineBreakdown: parseJson(row.baseline_breakdown, null),
      optimizedBreakdown: parseJson(row.optimized_breakdown, null),
      outcome: row.outcome ?? null,
      costDollars: row.cost_dollars ?? null,
      cloudEquivalentDollars: row.cloud_equivalent_dollars ?? null,
      createdAtEpoch: row.created_at_epoch,
    };
  }

  function upsertLaunchBudget({
    historySessionId, providerId, model,
    baselineTokens, optimizedTokens,
    baselineBreakdown, optimizedBreakdown,
    costDollars, cloudEquivalentDollars,
    createdAtEpoch,
  }) {
    launchBudgetStmts.upsert.run({
      historySessionId: Number(historySessionId),
      providerId,
      model: model ?? null,
      baselineTokens: Number(baselineTokens) || 0,
      optimizedTokens: Number(optimizedTokens) || 0,
      baselineBreakdown: toJson(baselineBreakdown ?? null),
      optimizedBreakdown: toJson(optimizedBreakdown ?? null),
      costDollars: costDollars ?? null,
      cloudEquivalentDollars: cloudEquivalentDollars ?? null,
      createdAtEpoch: Number(createdAtEpoch) || Math.floor(Date.now() / 1000),
    });
  }

  function setLaunchBudgetOutcome(historySessionId, outcome) {
    launchBudgetStmts.setOutcome.run({
      historySessionId: Number(historySessionId),
      outcome,
    });
  }

  function listLaunchBudgetsSince(sinceEpoch) {
    return launchBudgetStmts.listSince.all({ since: Number(sinceEpoch) || 0 }).map(rowToLaunchBudget);
  }

  const historySummaryStmts = {
    insert: db.prepare(`
      INSERT INTO history_summary (
        history_session_id, project_id, provider_id, summary_kind,
        request, investigated, learned, completed, next_steps,
        files_read, files_edited, notes, created_at, created_at_epoch
      ) VALUES (
        @historySessionId, @projectId, @providerId, @summaryKind,
        @request, @investigated, @learned, @completed, @nextSteps,
        @filesRead, @filesEdited, @notes, @createdAt, @createdAtEpoch
      )
    `),
    listByProject: db.prepare(`
      SELECT * FROM history_summary
      WHERE project_id = ?
      ORDER BY created_at_epoch DESC, history_summary_id DESC
      LIMIT ?
    `),
  };

  const historyObservationStmts = {
    insert: db.prepare(`
      INSERT INTO history_observation (
        history_session_id, project_id, provider_id, type, title, subtitle,
        narrative, facts, concepts, files_read, files_modified, turn_number,
        content_hash, generated_by_model, relevance_count, confidence,
        created_at, created_at_epoch, expires_at
      ) VALUES (
        @historySessionId, @projectId, @providerId, @type, @title, @subtitle,
        @narrative, @facts, @concepts, @filesRead, @filesModified, @turnNumber,
        @contentHash, @generatedByModel, @relevanceCount, @confidence,
        @createdAt, @createdAtEpoch, @expiresAt
      )
    `),
    listByProject: db.prepare(`
      SELECT * FROM history_observation
      WHERE project_id = ?
      ORDER BY created_at_epoch DESC, history_observation_id DESC
      LIMIT ?
    `),
  };

  function createHistorySession({
    projectId,
    personaId,
    providerId,
    providerSessionId,
    startedAt,
    endedAt,
    status,
    model,
    systemPrompt,
    source,
    createdAt,
    updatedAt,
  }) {
    const now = new Date().toISOString();
    const result = historySessionStmts.insert.run({
      projectId,
      personaId: personaId ?? null,
      providerId,
      providerSessionId: providerSessionId ?? null,
      startedAt: startedAt ?? null,
      endedAt: endedAt ?? null,
      status: status ?? 'completed',
      model: model ?? null,
      systemPrompt: systemPrompt ?? null,
      source: source ?? 'provider-hook',
      createdAt: createdAt ?? now,
      updatedAt: updatedAt ?? now,
    });
    return result.lastInsertRowid;
  }

  function getHistorySession(id) {
    return rowToHistorySession(historySessionStmts.getById.get(id));
  }

  function getHistorySessionByProvider(providerId, providerSessionId) {
    return rowToHistorySession(historySessionStmts.getByProvider.get(providerId, providerSessionId));
  }

  const historyMetricsStmts = {
    get: db.prepare(`SELECT * FROM history_session_metrics WHERE history_session_id = ?`),
    upsert: db.prepare(`
      INSERT INTO history_session_metrics (
        history_session_id,
        tokens_in, tokens_out, tokens_cache_read, tokens_cache_write,
        cost_usd, commits_produced, diff_exists, outcome, error,
        last_model, recorded_at
      ) VALUES (
        @historySessionId,
        COALESCE(@tokensIn, 0),
        COALESCE(@tokensOut, 0),
        COALESCE(@tokensCacheRead, 0),
        COALESCE(@tokensCacheWrite, 0),
        @costUsd,
        COALESCE(@commitsProduced, 0),
        @diffExists,
        @outcome,
        @error,
        @lastModel,
        @recordedAt
      )
      ON CONFLICT(history_session_id) DO UPDATE SET
        tokens_in          = COALESCE(@tokensIn, tokens_in),
        tokens_out         = COALESCE(@tokensOut, tokens_out),
        tokens_cache_read  = COALESCE(@tokensCacheRead, tokens_cache_read),
        tokens_cache_write = COALESCE(@tokensCacheWrite, tokens_cache_write),
        cost_usd           = COALESCE(@costUsd, cost_usd),
        commits_produced   = COALESCE(@commitsProduced, commits_produced),
        diff_exists        = COALESCE(@diffExists, diff_exists),
        outcome            = COALESCE(@outcome, outcome),
        error              = COALESCE(@error, error),
        last_model         = COALESCE(@lastModel, last_model),
        recorded_at        = @recordedAt
    `),
  };

  function rowToHistorySessionMetrics(row) {
    if (!row) return null;
    return {
      historySessionId: row.history_session_id,
      tokensIn: row.tokens_in ?? 0,
      tokensOut: row.tokens_out ?? 0,
      tokensCacheRead: row.tokens_cache_read ?? 0,
      tokensCacheWrite: row.tokens_cache_write ?? 0,
      costUsd: row.cost_usd ?? null,
      commitsProduced: row.commits_produced ?? 0,
      diffExists: row.diff_exists === 1 ? true : row.diff_exists === 0 ? false : null,
      outcome: row.outcome ?? null,
      error: row.error ?? null,
      lastModel: row.last_model ?? null,
      recordedAt: row.recorded_at,
    };
  }

  function upsertHistorySessionMetrics(historySessionId, fields = {}) {
    const diffExists =
      fields.diffExists === true ? 1 : fields.diffExists === false ? 0 : fields.diffExists ?? null;
    historyMetricsStmts.upsert.run({
      historySessionId: Number(historySessionId),
      tokensIn: fields.tokensIn ?? null,
      tokensOut: fields.tokensOut ?? null,
      tokensCacheRead: fields.tokensCacheRead ?? null,
      tokensCacheWrite: fields.tokensCacheWrite ?? null,
      costUsd: fields.costUsd ?? null,
      commitsProduced: fields.commitsProduced ?? null,
      diffExists,
      outcome: fields.outcome ?? null,
      error: fields.error ?? null,
      lastModel: fields.lastModel ?? null,
      recordedAt: fields.recordedAt ?? new Date().toISOString(),
    });
  }

  function getHistorySessionMetrics(historySessionId) {
    return rowToHistorySessionMetrics(historyMetricsStmts.get.get(Number(historySessionId)));
  }

  const getHistorySessionDetailStmt = db.prepare(`
    SELECT
      hs.history_session_id AS sessionId,
      hs.project_id         AS projectId,
      hs.persona_id         AS personaId,
      hs.provider_id        AS providerId,
      hs.provider_session_id AS providerSessionId,
      hs.started_at         AS startedAt,
      hs.ended_at           AS endedAt,
      hs.status             AS status,
      hs.source             AS source,
      hs.system_prompt      AS systemPrompt,
      p.name                AS projectName,
      p.path                AS projectPath,
      pe.label              AS personaLabel,
      pe.domain             AS personaDomain,
      COALESCE(m.tokens_in, 0)          AS tokensIn,
      COALESCE(m.tokens_out, 0)         AS tokensOut,
      COALESCE(m.tokens_cache_read, 0)  AS tokensCacheRead,
      COALESCE(m.tokens_cache_write, 0) AS tokensCacheWrite,
      (COALESCE(m.tokens_in,0)+COALESCE(m.tokens_out,0)+COALESCE(m.tokens_cache_read,0)+COALESCE(m.tokens_cache_write,0)) AS totalTokens,
      m.cost_usd            AS costUsd,
      m.last_model          AS lastModel,
      m.commits_produced    AS commitsProduced,
      m.diff_exists         AS diffExists,
      m.outcome             AS outcome,
      m.error               AS error
    FROM history_session hs
    LEFT JOIN project p ON p.project_id = hs.project_id
    LEFT JOIN persona pe ON pe.persona_id = hs.persona_id
    LEFT JOIN history_session_metrics m ON m.history_session_id = hs.history_session_id
    WHERE hs.history_session_id = ?
  `);

  function getHistorySessionDetail(id) {
    return getHistorySessionDetailStmt.get(id) ?? null;
  }

  function findHistorySessionIdByProvider(providerId, providerSessionId) {
    if (!providerId || !providerSessionId) return null;
    const row = historySessionStmts.getByProvider.get(providerId, providerSessionId);
    return row ? row.history_session_id : null;
  }

  const findLauncherHistorySessionStmt = db.prepare(`
    SELECT history_session_id
    FROM history_session
    WHERE project_id = @projectId
      AND persona_id = @personaId
      AND started_at = @startedAt
      AND source = 'launcher'
    ORDER BY history_session_id DESC
    LIMIT 1
  `);

  /**
   * Resolves the launcher-created history_session for a legacy session row
   * (matches by project_id + persona_id + started_at). Used by the telemetry
   * watcher handlers to bridge into history_session_metrics before the
   * provider hook has assigned a provider_session_id.
   */
  function findLauncherHistorySessionId({ projectId, personaId, startedAt }) {
    if (projectId == null || personaId == null || !startedAt) return null;
    const row = findLauncherHistorySessionStmt.get({
      projectId: Number(projectId),
      personaId: Number(personaId),
      startedAt,
    });
    return row ? row.history_session_id : null;
  }

  const historyStatsStmts = {
    countSince: db.prepare(`
      SELECT COUNT(*) AS count
      FROM history_session
      WHERE started_at IS NOT NULL AND started_at >= ?
    `),
    sumTokensSince: db.prepare(`
      SELECT COALESCE(SUM(
        hsm.tokens_in + hsm.tokens_out + hsm.tokens_cache_read + hsm.tokens_cache_write
      ), 0) AS total
      FROM history_session hs
      JOIN history_session_metrics hsm ON hsm.history_session_id = hs.history_session_id
      WHERE hs.started_at IS NOT NULL AND hs.started_at >= ?
    `),
    sumCommitsSince: db.prepare(`
      SELECT COALESCE(SUM(hsm.commits_produced), 0) AS total
      FROM history_session hs
      JOIN history_session_metrics hsm ON hsm.history_session_id = hs.history_session_id
      WHERE hs.ended_at IS NOT NULL AND hs.ended_at >= ?
    `),
    pulseSince: db.prepare(`
      SELECT
        strftime('%Y-%m-%dT%H:00:00.000Z', COALESCE(hs.ended_at, hs.started_at)) AS hour_start,
        COALESCE(SUM(
          hsm.tokens_in + hsm.tokens_out + hsm.tokens_cache_read + hsm.tokens_cache_write
        ), 0) AS tokens
      FROM history_session hs
      JOIN history_session_metrics hsm ON hsm.history_session_id = hs.history_session_id
      WHERE COALESCE(hs.ended_at, hs.started_at) IS NOT NULL
        AND COALESCE(hs.ended_at, hs.started_at) >= ?
      GROUP BY hour_start
      ORDER BY hour_start ASC
    `),
  };

  function countHistorySessionsSince(isoTimestamp) {
    return historyStatsStmts.countSince.get(isoTimestamp).count;
  }

  function sumHistoryTokensSince(isoTimestamp) {
    return historyStatsStmts.sumTokensSince.get(isoTimestamp).total;
  }

  function sumHistoryCommitsSince(isoTimestamp) {
    return historyStatsStmts.sumCommitsSince.get(isoTimestamp).total;
  }

  function getHistoryPulseBucketsSince(isoTimestamp) {
    return historyStatsStmts.pulseSince.all(isoTimestamp).map((row) => ({
      hourStart: row.hour_start,
      tokens: row.tokens,
    }));
  }

  function drainStuckHistorySessions({ ageHours = 1 } = {}) {
    const ageDays = Number(ageHours) / 24;
    const result = historySessionStmts.drainStuck.run({ ageDays });
    return { drained: result.changes ?? 0 };
  }

  function updateHistorySession(id, fields) {
    historySessionStmts.update.run({
      id,
      personaId: fields.personaId ?? null,
      providerSessionId: fields.providerSessionId ?? null,
      startedAt: fields.startedAt ?? null,
      endedAt: fields.endedAt ?? null,
      status: fields.status ?? null,
      model: fields.model ?? null,
      systemPrompt: fields.systemPrompt ?? null,
      source: fields.source ?? null,
      updatedAt: fields.updatedAt ?? new Date().toISOString(),
    });
  }

  function buildHistorySessionFilters({ personaId, projectId, source, unassigned } = {}) {
    const clauses = [];
    const params = {};
    if (unassigned) {
      clauses.push('hs.persona_id IS NULL');
    } else if (personaId != null) {
      clauses.push('hs.persona_id = @personaId');
      params.personaId = Number(personaId);
    }
    if (projectId != null) {
      clauses.push('hs.project_id = @projectId');
      params.projectId = Number(projectId);
    }
    if (source != null && source !== 'unassigned') {
      clauses.push('hs.source = @source');
      params.source = String(source);
    }
    return {
      where: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '',
      params,
    };
  }

  function rowToHistorySessionSummary(row) {
    if (!row) return null;
    const tokensIn = row.tokens_in ?? 0;
    const tokensOut = row.tokens_out ?? 0;
    const tokensCacheRead = row.tokens_cache_read ?? 0;
    const tokensCacheWrite = row.tokens_cache_write ?? 0;
    const startedAt = row.started_at ?? null;
    const endedAt = row.ended_at ?? null;
    return {
      id: row.history_session_id,
      projectId: row.project_id,
      projectName: row.project_name ?? null,
      projectPath: row.project_path ?? null,
      personaId: row.persona_id ?? null,
      personaLabel: row.persona_label ?? null,
      personaDomain: row.persona_domain ?? null,
      providerId: row.provider_id,
      providerSessionId: row.provider_session_id ?? null,
      source: row.source,
      status: row.status,
      model: row.model ?? null,
      startedAt,
      endedAt,
      durationSec:
        startedAt && endedAt
          ? Math.max(
              0,
              Math.round((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000),
            )
          : null,
      tokensIn,
      tokensOut,
      tokensCacheRead,
      tokensCacheWrite,
      totalTokens: tokensIn + tokensOut + tokensCacheRead + tokensCacheWrite,
      costUsd: row.cost_usd ?? null,
      commitsProduced: row.commits_produced ?? 0,
      diffExists: row.diff_exists === 1 ? true : row.diff_exists === 0 ? false : null,
      outcome: row.outcome ?? null,
      lastModel: row.last_model ?? row.model ?? null,
      summaryRequest: row.summary_request ?? null,
      summaryCompleted: row.summary_completed ?? null,
      summaryNextSteps: row.summary_next_steps ?? null,
      summaryCreatedAt: row.summary_created_at ?? null,
    };
  }

  function listHistorySessionsPage({
    page = 1,
    pageSize = 20,
    personaId,
    projectId,
    source,
    unassigned,
  } = {}) {
    const safePage = Math.max(1, Number(page) || 1);
    const safePageSize = Math.min(100, Math.max(1, Number(pageSize) || 20));
    const offset = (safePage - 1) * safePageSize;
    const { where, params } = buildHistorySessionFilters({
      personaId,
      projectId,
      source,
      unassigned,
    });

    const totalItems = db
      .prepare(`SELECT COUNT(*) AS count FROM history_session hs ${where}`)
      .get(params).count;

    const items = db
      .prepare(`
        SELECT
          hs.*,
          p.name AS project_name,
          p.path AS project_path,
          pe.label AS persona_label,
          pe.domain AS persona_domain,
          hsm.tokens_in,
          hsm.tokens_out,
          hsm.tokens_cache_read,
          hsm.tokens_cache_write,
          hsm.cost_usd,
          hsm.commits_produced,
          hsm.diff_exists,
          hsm.outcome,
          hsm.last_model,
          hsum.request AS summary_request,
          hsum.completed AS summary_completed,
          hsum.next_steps AS summary_next_steps,
          hsum.created_at AS summary_created_at
        FROM history_session hs
        LEFT JOIN project p ON p.project_id = hs.project_id
        LEFT JOIN persona pe ON pe.persona_id = hs.persona_id
        LEFT JOIN history_session_metrics hsm
          ON hsm.history_session_id = hs.history_session_id
        LEFT JOIN history_summary hsum
          ON hsum.history_summary_id = (
            SELECT history_summary_id FROM history_summary
            WHERE history_session_id = hs.history_session_id
            ORDER BY created_at_epoch DESC, history_summary_id DESC
            LIMIT 1
          )
        ${where}
        ORDER BY COALESCE(hs.ended_at, hs.started_at, hs.created_at) DESC,
                 hs.history_session_id DESC
        LIMIT @limit OFFSET @offset
      `)
      .all({ ...params, limit: safePageSize, offset })
      .map(rowToHistorySessionSummary);

    return {
      page: safePage,
      pageSize: safePageSize,
      totalItems,
      totalPages: Math.max(1, Math.ceil(totalItems / safePageSize)),
      items,
    };
  }

  function getHistorySessionWithContext(id) {
    const row = db
      .prepare(`
        SELECT
          hs.*,
          p.name AS project_name,
          p.path AS project_path,
          pe.label AS persona_label,
          pe.domain AS persona_domain,
          hsm.tokens_in,
          hsm.tokens_out,
          hsm.tokens_cache_read,
          hsm.tokens_cache_write,
          hsm.cost_usd,
          hsm.commits_produced,
          hsm.diff_exists,
          hsm.outcome,
          hsm.last_model,
          hsum.request AS summary_request,
          hsum.completed AS summary_completed,
          hsum.next_steps AS summary_next_steps,
          hsum.created_at AS summary_created_at,
          hsum.notes AS summary_notes,
          hsum.files_read AS summary_files_read,
          hsum.files_edited AS summary_files_edited
        FROM history_session hs
        LEFT JOIN project p ON p.project_id = hs.project_id
        LEFT JOIN persona pe ON pe.persona_id = hs.persona_id
        LEFT JOIN history_session_metrics hsm
          ON hsm.history_session_id = hs.history_session_id
        LEFT JOIN history_summary hsum
          ON hsum.history_summary_id = (
            SELECT history_summary_id FROM history_summary
            WHERE history_session_id = hs.history_session_id
            ORDER BY created_at_epoch DESC, history_summary_id DESC
            LIMIT 1
          )
        WHERE hs.history_session_id = ?
      `)
      .get(id);
    if (!row) return null;
    const summary = rowToHistorySessionSummary(row);
    const observations = db
      .prepare(`
        SELECT * FROM history_observation
        WHERE history_session_id = ?
        ORDER BY created_at_epoch DESC, history_observation_id DESC
        LIMIT 50
      `)
      .all(id)
      .map(rowToHistoryObservation);
    return {
      ...summary,
      systemPrompt: row.system_prompt ?? null,
      summaryNotes: row.summary_notes ?? null,
      summaryFilesRead: parseJson(row.summary_files_read, []),
      summaryFilesEdited: parseJson(row.summary_files_edited, []),
      observations,
    };
  }

  function createHistorySummary({
    historySessionId,
    projectId,
    providerId,
    summaryKind,
    request,
    investigated,
    learned,
    completed,
    nextSteps,
    filesRead,
    filesEdited,
    notes,
    createdAt,
    createdAtEpoch,
  }) {
    const timestamp = createdAt ?? new Date().toISOString();
    const result = historySummaryStmts.insert.run({
      historySessionId,
      projectId,
      providerId,
      summaryKind: summaryKind ?? 'checkpoint',
      request: request ?? null,
      investigated: investigated ?? null,
      learned: learned ?? null,
      completed: completed ?? null,
      nextSteps: nextSteps ?? null,
      filesRead: toJson(filesRead ?? []),
      filesEdited: toJson(filesEdited ?? []),
      notes: notes ?? null,
      createdAt: timestamp,
      createdAtEpoch: createdAtEpoch ?? new Date(timestamp).getTime(),
    });
    return result.lastInsertRowid;
  }

  function listHistorySummaries({ projectId, limit = 20 } = {}) {
    if (projectId == null) return [];
    return historySummaryStmts.listByProject.all(projectId, limit).map(rowToHistorySummary);
  }

  function createHistoryObservation({
    historySessionId,
    projectId,
    providerId,
    type,
    title,
    subtitle,
    narrative,
    facts,
    concepts,
    filesRead,
    filesModified,
    turnNumber,
    contentHash,
    generatedByModel,
    relevanceCount,
    confidence,
    createdAt,
    createdAtEpoch,
    expiresAt,
  }) {
    const timestamp = createdAt ?? new Date().toISOString();
    const result = historyObservationStmts.insert.run({
      historySessionId,
      projectId,
      providerId,
      type,
      title: title ?? null,
      subtitle: subtitle ?? null,
      narrative: narrative ?? null,
      facts: toJson(facts ?? []),
      concepts: toJson(concepts ?? []),
      filesRead: toJson(filesRead ?? []),
      filesModified: toJson(filesModified ?? []),
      turnNumber: turnNumber ?? null,
      contentHash: contentHash ?? null,
      generatedByModel: generatedByModel ?? null,
      relevanceCount: relevanceCount ?? 0,
      confidence: confidence ?? 1.0,
      createdAt: timestamp,
      createdAtEpoch: createdAtEpoch ?? new Date(timestamp).getTime(),
      expiresAt: expiresAt ?? null,
    });
    return result.lastInsertRowid;
  }

  function listHistoryObservations({ projectId, limit = 50 } = {}) {
    if (projectId == null) return [];
    return historyObservationStmts.listByProject.all(projectId, limit).map(rowToHistoryObservation);
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

  // ── Portfolio Stats Snapshot ───────────────────────────────────────────────

  function rowToPortfolioStatsSnapshot(row) {
    if (!row) return null;
    return {
      window: row.window_key,
      computedAt: row.computed_at,
      repoCount: row.repo_count,
      commitCount: row.commit_count,
      fileCount: row.file_count,
      sessionCount: row.session_count,
      tokenTotal: row.token_total,
    };
  }

  const portfolioStatsStmts = {
    upsert: db.prepare(`
      INSERT INTO portfolio_stats_snapshot (
        window_key, computed_at, repo_count, commit_count, file_count, session_count, token_total
      ) VALUES (
        @window, @computedAt, @repoCount, @commitCount, @fileCount, @sessionCount, @tokenTotal
      )
      ON CONFLICT(window_key) DO UPDATE SET
        computed_at = excluded.computed_at,
        repo_count = excluded.repo_count,
        commit_count = excluded.commit_count,
        file_count = excluded.file_count,
        session_count = excluded.session_count,
        token_total = excluded.token_total
    `),
    getByWindow: db.prepare(`SELECT * FROM portfolio_stats_snapshot WHERE window_key = ?`),
    listAll: db.prepare(`SELECT * FROM portfolio_stats_snapshot ORDER BY window_key`),
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

  /**
   * @param {{ window: string, computedAt: string, repoCount: number, commitCount: number, fileCount: number, sessionCount: number, tokenTotal: number }} fields
   */
  function upsertPortfolioStatsSnapshot(fields) {
    portfolioStatsStmts.upsert.run({
      window: fields.window,
      computedAt: fields.computedAt,
      repoCount: fields.repoCount ?? 0,
      commitCount: fields.commitCount ?? 0,
      fileCount: fields.fileCount ?? 0,
      sessionCount: fields.sessionCount ?? 0,
      tokenTotal: fields.tokenTotal ?? 0,
    });
  }

  /**
   * @param {string} window
   * @returns {object|null}
   */
  function getPortfolioStatsSnapshot(window) {
    return rowToPortfolioStatsSnapshot(portfolioStatsStmts.getByWindow.get(window));
  }

  /**
   * @returns {object[]}
   */
  function listPortfolioStatsSnapshots() {
    return portfolioStatsStmts.listAll.all().map(rowToPortfolioStatsSnapshot);
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  return {
    // Projects
    createProject,
    getProject,
    getProjectByPath,
    listProjects,
    updateProject,
    deleteProject,

    // Personas
    createPersona,
    getPersona,
    listPersonas,
    updatePersona,

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
    getSessionDetail,
    updateSession,
    getActiveSessions,
    listSessionsPage,
    countSessionsSince,
    sumTokensSince,
    sumCommitsSince,
    getPulseBucketsSince,

    // Project history
    createHistorySession,
    getHistorySession,
    getHistorySessionByProvider,
    getHistorySessionWithContext,
    listHistorySessionsPage,
    upsertHistorySessionMetrics,
    getHistorySessionMetrics,
    getHistorySessionDetail,
    findHistorySessionIdByProvider,
    findLauncherHistorySessionId,
    countHistorySessionsSince,
    sumHistoryTokensSince,
    sumHistoryCommitsSince,
    getHistoryPulseBucketsSince,
    updateHistorySession,
    drainStuckHistorySessions,
    upsertLaunchBudget,
    setLaunchBudgetOutcome,
    listLaunchBudgetsSince,
    createHistorySummary,
    listHistorySummaries,
    createHistoryObservation,
    listHistoryObservations,

    // GardenLogs
    createGardenLog,
    getGardenLog,

    // GardenRules
    createGardenRule,
    listGardenRules,

    // Portfolio stats snapshots
    upsertPortfolioStatsSnapshot,
    getPortfolioStatsSnapshot,
    listPortfolioStatsSnapshots,
  };
}
