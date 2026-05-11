/* global process */
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

function llmProxy(env) {
  const key = env.GROQ_API_KEY || ''
  return {
    '/api/llm': {
      target: 'https://api.groq.com',
      changeOrigin: true,
      rewrite: () => '/openai/v1/chat/completions',
      configure: (proxy) => {
        proxy.on('proxyReq', (proxyReq) => {
          if (key) proxyReq.setHeader('Authorization', `Bearer ${key}`)
        })
      },
    },
  }
}

function sunoProxy(env) {
  const key = env.SUNO_API_KEY || ''
  return {
    '/api/suno': {
      target: 'https://api.sunoapi.org',
      changeOrigin: true,
      rewrite: (path) => path.replace(/^\/api\/suno/, '/api/v1'),
      configure: (proxy) => {
        proxy.on('proxyReq', (proxyReq) => {
          if (key) proxyReq.setHeader('Authorization', `Bearer ${key}`)
        })
      },
    },
  }
}

function runwareProxy(env) {
  const key = env.RUNWARE_API_KEY || ''
  return {
    '/api/runware': {
      target: 'https://api.runware.ai',
      changeOrigin: true,
      rewrite: () => '/v1',
      configure: (proxy) => {
        proxy.on('proxyReq', (proxyReq) => {
          if (key) proxyReq.setHeader('Authorization', `Bearer ${key}`)
        })
      },
    },
  }
}

function falProxy(env) {
  const key = env.FAL_KEY || ''
  return {
    '/api/fal': {
      target: 'https://queue.fal.run',
      changeOrigin: true,
      rewrite: (path) => path.replace(/^\/api\/fal/, ''),
      configure: (proxy) => {
        proxy.on('proxyReq', (proxyReq) => {
          if (key) proxyReq.setHeader('Authorization', `Key ${key}`)
        })
      },
    },
  }
}

function huggingFaceProxy(env) {
  const key = env.HF_API_KEY || ''
  const auth = (proxy) => {
    proxy.on('proxyReq', (proxyReq) => {
      if (key) proxyReq.setHeader('Authorization', `Bearer ${key}`)
    })
  }
  return {
    '/api/hf-musicgen': {
      target: 'https://api-inference.huggingface.co/models/facebook/musicgen-small',
      changeOrigin: true,
      rewrite: () => '',
      configure: auth,
    },
    '/api/hf-stable-audio': {
      target: 'https://api-inference.huggingface.co/models/stabilityai/stable-audio-open-1.0',
      changeOrigin: true,
      rewrite: () => '',
      configure: auth,
    },
  }
}

function localAceProxy(env) {
  const target = env.LOCAL_ACE_STEP_API_URL || 'http://127.0.0.1:8001'
  return {
    '/api/local-ace': {
      target,
      changeOrigin: true,
      rewrite: (path) => path.replace(/^\/api\/local-ace/, ''),
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const proxy = {
    ...llmProxy(env),
    ...sunoProxy(env),
    ...falProxy(env),
    ...runwareProxy(env),
    ...huggingFaceProxy(env),
    ...localAceProxy(env),
  }
  return {
    plugins: [react()],
    define: {
      'import.meta.env.VITE_HAS_SUNO_API_KEY': JSON.stringify(Boolean(env.SUNO_API_KEY)),
      'import.meta.env.VITE_HAS_FAL_KEY': JSON.stringify(Boolean(env.FAL_KEY)),
      'import.meta.env.VITE_HAS_RUNWARE_API_KEY': JSON.stringify(Boolean(env.RUNWARE_API_KEY)),
      'import.meta.env.VITE_HAS_HF_API_KEY': JSON.stringify(Boolean(env.HF_API_KEY)),
      'import.meta.env.VITE_HAS_LOCAL_ACE_STEP_API_URL': JSON.stringify(Boolean(env.LOCAL_ACE_STEP_API_URL)),
    },
    server: { proxy },
    preview: { proxy },
  }
})
