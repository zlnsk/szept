import { create } from 'zustand'

export interface UploadTask {
  id: string
  roomId: string
  fileName: string
  fileSize: number
  progress: number // 0-100
  status: 'queued' | 'uploading' | 'sending' | 'done' | 'failed'
  error?: string
}

interface UploadState {
  tasks: UploadTask[]
  addTask: (task: Omit<UploadTask, 'progress' | 'status'>) => void
  updateProgress: (id: string, progress: number) => void
  setStatus: (id: string, status: UploadTask['status'], error?: string) => void
  removeTask: (id: string) => void
  getTasksForRoom: (roomId: string) => UploadTask[]
}

export const useUploadStore = create<UploadState>((set, get) => ({
  tasks: [],

  addTask: (task) => {
    set((state) => ({
      tasks: [...state.tasks, { ...task, progress: 0, status: 'queued' }],
    }))
  },

  updateProgress: (id, progress) => {
    set((state) => ({
      tasks: state.tasks.map((t) =>
        t.id === id ? { ...t, progress, status: 'uploading' as const } : t
      ),
    }))
  },

  setStatus: (id, status, error) => {
    set((state) => ({
      tasks: state.tasks.map((t) =>
        t.id === id ? { ...t, status, ...(error ? { error } : {}) } : t
      ),
    }))
    // Auto-remove completed tasks after 2 seconds, failed after 5 seconds
    if (status === 'done') {
      setTimeout(() => get().removeTask(id), 2000)
    } else if (status === 'failed') {
      setTimeout(() => get().removeTask(id), 5000)
    }
  },

  removeTask: (id) => {
    set((state) => ({
      tasks: state.tasks.filter((t) => t.id !== id),
    }))
  },

  getTasksForRoom: (roomId) => {
    return get().tasks.filter((t) => t.roomId === roomId)
  },
}))
