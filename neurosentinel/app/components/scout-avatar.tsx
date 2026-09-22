'use client'

export function ScoutAvatar({
  size = 44,
  pulse = false,
  compact = false,
  showStatus = false,
  variant = 'clinical',
}: {
  size?: number
  pulse?: boolean
  compact?: boolean
  showStatus?: boolean
  variant?: 'clinical' | 'primary'
}) {
  const isPrimary = variant === 'primary'
  
  const bgColor = isPrimary 
    ? 'linear-gradient(135deg, #3B82F6, #06B6D4)' 
    : (compact ? '#F9FAFB' : '#EFF6FF')
  
  const borderColor = isPrimary 
    ? 'rgba(255, 255, 255, 0.6)' 
    : (compact ? '#E5E7EB' : '#BFDBFE')
  
  const iconColor = isPrimary ? '#FFFFFF' : (compact ? '#6B7280' : '#3B82F6')
  const bubbleColor = isPrimary ? 'rgba(255, 255, 255, 0.25)' : (compact ? '#F3F4F6' : '#DBEAFE')

  return (
    <div className="relative flex items-center justify-center">
      <div
        className="relative flex items-center justify-center rounded-lg shadow-sm"
        style={{
          width: size,
          height: size,
          background: bgColor,
          border: isPrimary ? `2px solid ${borderColor}` : `1px solid ${borderColor}`,
          boxShadow: isPrimary ? 'inset 0 0 8px rgba(255,255,255,0.2)' : 'none',
        }}
      >
        {pulse ? (
          <span
            className="absolute inset-0 rounded-lg"
            style={{
              border: `1px solid ${isPrimary ? '#FFFFFF' : '#3B82F6'}`,
              animation: 'ping 2s cubic-bezier(0,0,0.2,1) infinite',
              opacity: 0.3,
            }}
          />
        ) : null}

        <svg width={size * 0.6} height={size * 0.6} viewBox="0 0 48 48" fill="none" aria-hidden="true">
          <path
            d="M10 11.5C10 8.46243 12.4624 6 15.5 6H32.5C35.5376 6 38 8.46243 38 11.5V24.5C38 27.5376 35.5376 30 32.5 30H22L14 36V30.0045C11.7613 29.7775 10 27.8899 10 25.5V11.5Z"
            fill={bubbleColor}
            stroke={iconColor}
            strokeWidth="3.5"
            strokeLinejoin="round"
          />
          <circle cx="19" cy="18" r="2.2" fill={iconColor} />
          <circle cx="29" cy="18" r="2.2" fill={iconColor} />
          <path
            d="M18 24C19.5 26 21.5 27 24 27C26.5 27 28.5 26 30 24"
            stroke={iconColor}
            strokeWidth="2.8"
            strokeLinecap="round"
          />
        </svg>
      </div>
      
      {showStatus && (
        <span 
          className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-[#10B981] shadow-sm"
          title="SCOUT active"
        />
      )}
    </div>
  )
}
