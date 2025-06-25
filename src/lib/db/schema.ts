import { pgTable, text, timestamp, boolean, jsonb, uuid, varchar, index } from 'drizzle-orm/pg-core';

// Users table with secure authentication
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  username: varchar('username', { length: 50 }).notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  firstName: varchar('first_name', { length: 100 }),
  lastName: varchar('last_name', { length: 100 }),
  isActive: boolean('is_active').default(true),
  emailVerified: boolean('email_verified').default(false),
  role: varchar('role', { length: 50 }).default('user'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
  lastLoginAt: timestamp('last_login_at'),
  profilePicture: text('profile_picture'),
  bio: text('bio'),
  timezone: varchar('timezone', { length: 50 }).default('UTC'),
  language: varchar('language', { length: 10 }).default('en'),
  theme: varchar('theme', { length: 20 }).default('dark'),
}, (table) => ({
  emailIdx: index('users_email_idx').on(table.email),
  usernameIdx: index('users_username_idx').on(table.username),
}));

// Encrypted user secrets and API keys
export const userSecrets = pgTable('user_secrets', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  secretType: varchar('secret_type', { length: 100 }).notNull(), // 'api_key', 'oauth_token', 'custom'
  serviceName: varchar('service_name', { length: 100 }).notNull(), // 'openai', 'anthropic', 'github', etc.
  encryptedValue: text('encrypted_value').notNull(), // AES encrypted
  encryptedIv: text('encrypted_iv').notNull(), // Initialization vector
  description: text('description'),
  isActive: boolean('is_active').default(true),
  expiresAt: timestamp('expires_at'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => ({
  userServiceIdx: index('user_secrets_user_service_idx').on(table.userId, table.serviceName),
  typeIdx: index('user_secrets_type_idx').on(table.secretType),
}));

// User preferences and settings
export const userPreferences = pgTable('user_preferences', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  preferences: jsonb('preferences').notNull().default('{}'), // Flexible JSON for all settings
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => ({
  userIdx: index('user_preferences_user_idx').on(table.userId),
}));

// Session management
export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
  ipAddress: varchar('ip_address', { length: 45 }),
  userAgent: text('user_agent'),
  isActive: boolean('is_active').default(true),
}, (table) => ({
  userIdx: index('sessions_user_idx').on(table.userId),
  expiresIdx: index('sessions_expires_idx').on(table.expiresAt),
}));

// Password reset tokens
export const passwordResetTokens = pgTable('password_reset_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  token: text('token').notNull().unique(),
  expiresAt: timestamp('expires_at').notNull(),
  used: boolean('used').default(false),
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => ({
  tokenIdx: index('password_reset_tokens_token_idx').on(table.token),
  userIdx: index('password_reset_tokens_user_idx').on(table.userId),
}));

// Email verification tokens
export const emailVerificationTokens = pgTable('email_verification_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  token: text('token').notNull().unique(),
  expiresAt: timestamp('expires_at').notNull(),
  used: boolean('used').default(false),
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => ({
  tokenIdx: index('email_verification_tokens_token_idx').on(table.token),
  userIdx: index('email_verification_tokens_user_idx').on(table.userId),
}));

// Audit log for security
export const auditLog = pgTable('audit_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  action: varchar('action', { length: 100 }).notNull(),
  resource: varchar('resource', { length: 100 }),
  resourceId: text('resource_id'),
  details: jsonb('details'),
  ipAddress: varchar('ip_address', { length: 45 }),
  userAgent: text('user_agent'),
  timestamp: timestamp('timestamp').defaultNow(),
}, (table) => ({
  userIdx: index('audit_log_user_idx').on(table.userId),
  actionIdx: index('audit_log_action_idx').on(table.action),
  timestampIdx: index('audit_log_timestamp_idx').on(table.timestamp),
}));

// User API usage tracking
export const apiUsage = pgTable('api_usage', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  service: varchar('service', { length: 100 }).notNull(),
  endpoint: varchar('endpoint', { length: 200 }),
  requestCount: varchar('request_count', { length: 50 }).default('1'),
  tokens: varchar('tokens', { length: 50 }),
  cost: varchar('cost', { length: 50 }),
  date: timestamp('date').defaultNow(),
  metadata: jsonb('metadata').default('{}'),
}, (table) => ({
  userServiceIdx: index('api_usage_user_service_idx').on(table.userId, table.service),
  dateIdx: index('api_usage_date_idx').on(table.date),
}));

// Types for TypeScript
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type UserSecret = typeof userSecrets.$inferSelect;
export type NewUserSecret = typeof userSecrets.$inferInsert;
export type UserPreference = typeof userPreferences.$inferSelect;
export type NewUserPreference = typeof userPreferences.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
