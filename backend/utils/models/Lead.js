'use strict';

const mongoose = require('mongoose');

/**
 * Lead schema for the caprae_leadgen_db database.
 * One document per processed lead, holding the raw input, the verification
 * result and the score produced by the heuristic engine.
 */
const LeadSchema = new mongoose.Schema(
  {
    company: {
      type: String,
      trim: true,
      default: '',
      maxlength: 200,
    },
    domain: {
      type: String,
      trim: true,
      lowercase: true,
      default: '',
      maxlength: 253,
      index: true,
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      required: [true, 'An email address is required to process a lead.'],
      maxlength: 320,
    },
    industry: {
      type: String,
      trim: true,
      default: '',
      maxlength: 120,
    },
    website: {
      type: String,
      trim: true,
      default: '',
      maxlength: 500,
    },

    // ---- Verification results -------------------------------------------
    syntaxValid: {
      type: Boolean,
      default: false,
    },
    mxVerified: {
      type: Boolean,
      default: false,
    },
    mxStatus: {
      type: String,
      enum: ['verified', 'unverified', 'error', 'skipped'],
      default: 'unverified',
    },
    mxRecords: {
      type: [String],
      default: [],
    },
    disposable: {
      type: Boolean,
      default: false,
    },
    freeProvider: {
      type: Boolean,
      default: false,
    },
    roleBased: {
      type: Boolean,
      default: false,
    },
    verificationNotes: {
      type: [String],
      default: [],
    },

    // ---- Scoring ---------------------------------------------------------
    score: {
      type: Number,
      min: 0,
      max: 100,
      default: 0,
      index: true,
    },
    quality: {
      type: String,
      enum: ['High Quality', 'Medium', 'Low Quality'],
      default: 'Low Quality',
      index: true,
    },
    scoreBreakdown: {
      type: [
        {
          _id: false,
          label: { type: String, default: '' },
          points: { type: Number, default: 0 },
        },
      ],
      default: [],
    },

    source: {
      type: String,
      enum: ['manual', 'csv'],
      default: 'manual',
    },

    // ---- Contact & email discovery ---------------------------------------
    contactFirstName: {
      type: String,
      trim: true,
      default: '',
      maxlength: 100,
    },
    contactLastName: {
      type: String,
      trim: true,
      default: '',
      maxlength: 100,
    },
    emailSource: {
      type: String,
      enum: ['provided', 'pattern-guess'],
      default: 'provided',
    },
    emailConfidence: {
      type: String,
      enum: ['confirmed', 'catch-all', 'unconfirmed', null],
      default: null,
    },

    // ---- Company enrichment ------------------------------------------------
    enrichment: {
      siteTitle: { type: String, trim: true, default: '' },
      siteDescription: { type: String, trim: true, default: '' },
      detectedIndustry: { type: String, trim: true, default: '' },
      note: { type: String, trim: true, default: '' },
      fetchedAt: { type: Date, default: null },
    },
  },
  {
    timestamps: true,
    collection: 'leads',
  }
);

// Prevent the same email being stored twice from repeated batch runs.
LeadSchema.index({ email: 1 }, { unique: true });

LeadSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (doc, ret) => {
    ret.id = ret._id ? ret._id.toString() : ret.id;
    delete ret._id;
    return ret;
  },
});

module.exports = mongoose.models.Lead || mongoose.model('Lead', LeadSchema);
