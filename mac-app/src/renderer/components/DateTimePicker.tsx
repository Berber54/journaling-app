import React, { useState } from 'react';

interface DateTimePickerProps {
  currentDate: string;
  onSave: (isoDate: string) => void;
  onCancel: () => void;
}

export default function DateTimePicker({ currentDate, onSave, onCancel }: DateTimePickerProps) {
  const d = new Date(currentDate);
  const localIso = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
  const [value, setValue] = useState(localIso);

  const handleSave = () => {
    const date = new Date(value);
    onSave(date.toISOString());
  };

  const handleSetNow = () => {
    const now = new Date();
    const localNow = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);
    setValue(localNow);
  };

  return (
    <div className="delete-dialog-overlay">
      <div className="delete-dialog" style={{ minWidth: '380px' }}>
        <h3>Set Date & Time</h3>
        <p>Change the date for this journal entry (useful for importing past entries).</p>

        <input
          type="datetime-local"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="input"
          style={{ marginBottom: '16px' }}
        />

        <div className="delete-dialog-actions" style={{ justifyContent: 'space-between' }}>
          <button className="btn btn-secondary" onClick={handleSetNow}>
            Set to Now
          </button>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="btn btn-secondary" onClick={onCancel}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={handleSave}>
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
