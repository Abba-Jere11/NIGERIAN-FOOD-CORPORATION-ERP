/**
 * Device clock-in hardware is deferred past M17. CSV import is the real
 * attendance ingest. This interface is named so a later connector can slot in
 * without inventing a second attendance path.
 */
export interface HrAttendanceDeviceEvent {
  employeeReference: string;
  punchedAt: string;
  direction: 'IN' | 'OUT';
}

export interface HrAttendanceDeviceConnector {
  readonly name: string;
  pullSince(since: Date): Promise<HrAttendanceDeviceEvent[]>;
}

export class DeferredAttendanceDeviceConnector implements HrAttendanceDeviceConnector {
  readonly name = 'deferred-device';

  pullSince(_since: Date): Promise<HrAttendanceDeviceEvent[]> {
    return Promise.reject(
      new Error('Device attendance is deferred. Import a CSV sheet or record attendance by hand.'),
    );
  }
}
