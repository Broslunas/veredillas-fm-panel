import mongoose, { Schema, Document } from 'mongoose';

export type AuditAction = 'create' | 'update' | 'delete' | 'restore' | 'permanent_delete' | 'role_change' | 'export';

export interface IAuditLog extends Document {
  _id: mongoose.Types.ObjectId;
  actorId: string;
  actorName: string;
  actorEmail: string;
  actorRole: string;
  action: AuditAction;
  resource: string;
  resourceId?: string;
  label?: string;
  changes?: Record<string, { before: unknown; after: unknown }>;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

const auditLogSchema = new Schema<IAuditLog>(
  {
    actorId: { type: String, required: true },
    actorName: { type: String, required: true },
    actorEmail: { type: String, required: true },
    actorRole: { type: String, required: true },
    action: {
      type: String,
      enum: ['create', 'update', 'delete', 'restore', 'permanent_delete', 'role_change', 'export'],
      required: true,
    },
    resource: { type: String, required: true },
    resourceId: { type: String },
    label: { type: String },
    changes: { type: Schema.Types.Mixed },
    metadata: { type: Schema.Types.Mixed },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ resource: 1, resourceId: 1 });
auditLogSchema.index({ actorId: 1 });

if (mongoose.models.AuditLog) {
  delete mongoose.models.AuditLog;
}

const AuditLog = mongoose.model<IAuditLog>('AuditLog', auditLogSchema);
export default AuditLog;
