import React from 'react';

interface IconProps extends React.SVGProps<SVGSVGElement> {
  size?: number;
  color?: string;
}

export const CustomSquareUncheck: React.FC<IconProps> = ({ size = 32, color = '#1D1C1C', ...props }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
    <path d="M25.3333 4H6.66667C5.19391 4 4 5.19391 4 6.66667V25.3333C4 26.8061 5.19391 28 6.66667 28H25.3333C26.8061 28 28 26.8061 28 25.3333V6.66667C28 5.19391 26.8061 4 25.3333 4Z" stroke={color} strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

export const CustomSquareCheck: React.FC<IconProps> = ({ size = 32, color = '#1D1C1C', ...props }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
    <path d="M12 16L14.6667 18.6667L20 13.3333M6.66667 4H25.3333C26.8061 4 28 5.19391 28 6.66667V25.3333C28 26.8061 26.8061 28 25.3333 28H6.66667C5.19391 28 4 26.8061 4 25.3333V6.66667C4 5.19391 5.19391 4 6.66667 4Z" stroke={color} strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

export const CustomChevronDown: React.FC<IconProps> = ({ size = 32, color = '#1D1C1C', ...props }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
    <path d="M8 12L16 20L24 12" stroke={color} strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

export const CustomChevronUp: React.FC<IconProps> = ({ size = 32, color = '#1D1C1C', ...props }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
    <path d="M24 20L16 12L8 20" stroke={color} strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

export const CustomX: React.FC<IconProps> = ({ size = 24, color = '#1D1C1C', ...props }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
    <path d="M16 8L8 16M8 8L16 16" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);
