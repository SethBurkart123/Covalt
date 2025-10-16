import { AllChatsData } from '@/lib/types/chat';

export class DataMigrationService {
  private static instance: DataMigrationService;

  private constructor() {}

  static getInstance(): DataMigrationService {
    if (!DataMigrationService.instance) {
      DataMigrationService.instance = new DataMigrationService();
    }
    return DataMigrationService.instance;
  }

  hasLocalStorageData(): boolean {
    try {
      const raw = localStorage.getItem('chat-storage');
      if (!raw) return false;
      const data = JSON.parse(raw) as AllChatsData;
      return !!data && typeof data.chats === 'object' && Object.keys(data.chats).length > 0;
    } catch {
      return false;
    }
  }

  getLocalStorageData(): AllChatsData | null {
    try {
      const raw = localStorage.getItem('chat-storage');
      if (!raw) return null;
      const data = JSON.parse(raw) as AllChatsData;
      return data && typeof data.chats === 'object' ? data : null;
    } catch {
      return null;
    }
  }

  async migrateToBackend(): Promise<{ success: boolean; migratedCount: number; errors: string[] }> {
    return { success: false, migratedCount: 0, errors: ['Backend not configured'] };
  }

  clearLocalStorageData(): void {
    try { localStorage.removeItem('chat-storage'); } catch {}
  }

  async performFullMigration(): Promise<{ success: boolean; migratedCount: number; errors: string[] }> {
    return this.migrateToBackend();
  }
}

export const dataMigrationService = DataMigrationService.getInstance();
