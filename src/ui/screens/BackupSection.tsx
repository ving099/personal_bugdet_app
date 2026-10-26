import type { ISODate } from '../../domain/types'
import BackupPanel from '../components/BackupPanel'
import { todayISO } from '../formValues'
import { SettingsSection } from './SettingsSection'

/** The Settings entry for encrypted backup and restore. The controls live in BackupPanel. */
export default function BackupSection({ today = todayISO() }: { today?: ISODate }) {
  return (
    <SettingsSection title="Backup and restore">
      <BackupPanel today={today} />
    </SettingsSection>
  )
}
