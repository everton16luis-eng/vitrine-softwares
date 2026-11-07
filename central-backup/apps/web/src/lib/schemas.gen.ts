// GERADO por scripts/web-gen.ts — não edite à mão.
import type { JsonSchema } from './openapi.ts';
export const CONFIG_SCHEMAS = {
 "storage": {
  "local_rest": {
   "type": "object",
   "required": [
    "agent_url",
    "data_dir"
   ],
   "properties": {
    "agent_url": {
     "type": "string",
     "pattern": "^https?://[^\\s/]+(:\\d+)?/?$",
     "maxLength": 200
    },
    "data_dir": {
     "type": "string",
     "pattern": "^(?!.*(^|[\\\\/])\\.\\.([\\\\/]|$))(/|[A-Za-z]:[\\\\/])[^\\x00-\\x1f]*$",
     "maxLength": 500
    }
   },
   "additionalProperties": false
  },
  "s3": {
   "type": "object",
   "required": [
    "provider",
    "endpoint",
    "bucket"
   ],
   "properties": {
    "provider": {
     "anyOf": [
      {
       "type": "string",
       "const": "aws"
      },
      {
       "type": "string",
       "const": "minio"
      },
      {
       "type": "string",
       "const": "r2"
      },
      {
       "type": "string",
       "const": "b2"
      },
      {
       "type": "string",
       "const": "outro"
      }
     ]
    },
    "endpoint": {
     "type": "string",
     "pattern": "^https?://[^\\s]+$",
     "maxLength": 300
    },
    "bucket": {
     "type": "string",
     "pattern": "^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$"
    },
    "prefix": {
     "type": "string",
     "pattern": "^[A-Za-z0-9/_-]{0,200}$"
    },
    "region": {
     "type": "string",
     "pattern": "^[a-z0-9-]{2,40}$"
    }
   },
   "additionalProperties": false
  },
  "s3_credential": {
   "type": "object",
   "required": [
    "access_key_id",
    "secret_access_key"
   ],
   "properties": {
    "access_key_id": {
     "type": "string",
     "minLength": 3,
     "maxLength": 200
    },
    "secret_access_key": {
     "type": "string",
     "minLength": 8,
     "maxLength": 300
    }
   },
   "additionalProperties": false
  }
 },
 "channels": {
  "email": {
   "type": "object",
   "required": [
    "to"
   ],
   "properties": {
    "to": {
     "type": "array",
     "items": {
      "type": "string",
      "format": "email",
      "maxLength": 200
     },
     "minItems": 1,
     "maxItems": 20
    }
   },
   "additionalProperties": false
  },
  "webhook_secret": {
   "type": "object",
   "required": [
    "url",
    "signing_key"
   ],
   "properties": {
    "url": {
     "type": "string",
     "pattern": "^(https://[^\\s]+|http://(127\\.0\\.0\\.1|localhost)(:\\d+)?/[^\\s]*)$",
     "maxLength": 500
    },
    "signing_key": {
     "type": "string",
     "minLength": 16,
     "maxLength": 200
    }
   },
   "additionalProperties": false
  },
  "whatsapp": {
   "type": "object",
   "required": [
    "phone_number_id",
    "to"
   ],
   "properties": {
    "phone_number_id": {
     "type": "string",
     "pattern": "^\\d{5,30}$"
    },
    "to": {
     "type": "array",
     "items": {
      "type": "string",
      "pattern": "^\\d{10,15}$"
     },
     "minItems": 1,
     "maxItems": 10
    },
    "template": {
     "type": "string",
     "pattern": "^[a-z0-9_]{1,100}$"
    },
    "language": {
     "type": "string",
     "pattern": "^[a-z]{2}(_[A-Z]{2})?$"
    },
    "api_base": {
     "type": "string",
     "pattern": "^(https://graph\\.facebook\\.com/v\\d+\\.\\d+|http://(127\\.0\\.0\\.1|localhost):\\d+)$"
    }
   },
   "additionalProperties": false
  },
  "whatsapp_secret": {
   "type": "object",
   "required": [
    "access_token"
   ],
   "properties": {
    "access_token": {
     "type": "string",
     "minLength": 20,
     "maxLength": 1000
    }
   },
   "additionalProperties": false
  }
 }
} as unknown as Record<'storage' | 'channels', Record<string, JsonSchema>>;
