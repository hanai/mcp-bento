import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js'

export function extractMessageArgument(args) {
  if (!args || typeof args !== 'object') {
    throw new McpError(ErrorCode.InvalidParams, 'Missing arguments')
  }
  const { message } = args
  if (typeof message !== 'string') {
    throw new McpError(
      ErrorCode.InvalidParams,
      'Argument "message" must be a string'
    )
  }
  return message
}

export function createMessageSchema() {
  return {
    type: 'object',
    properties: {
      message: {
        type: 'string',
        description: 'Message to echo back',
      },
    },
    required: ['message'],
  }
}

export function createEchoResult(source, message) {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({ source, message }),
      },
    ],
    isError: false,
  }
}

export function createPromptResult(text) {
  return {
    description: text,
    messages: [
      {
        role: 'assistant',
        content: {
          type: 'text',
          text,
        },
      },
    ],
  }
}
