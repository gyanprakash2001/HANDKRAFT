export const Theme = {
  // Global Card Styles
  GlobalCard: {
    backgroundColor: '#000000',
    borderColor: '#FFFFFF',
    borderWidth: 1,
    borderRadius: 12,
    padding: 15,
  },
  
  // Compact Card (smaller padding)
  CompactCard: {
    backgroundColor: '#000000',
    borderColor: '#FFFFFF',
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
  },
  
  // Text Styles
  PrimaryText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600' as const,
  },
  
  HeadingText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700' as const,
  },
  
  SubtleText: {
    color: '#A8BCD0',
    fontSize: 12,
    fontWeight: '500' as const,
  },
  
  // Category Chips (Oval)
  CategoryChip: {
    backgroundColor: '#000000',
    borderColor: '#FFFFFF',
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  
  CategoryChipText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600' as const,
  },
  
  // Post Tags (Rectangular)
  PostTag: {
    backgroundColor: 'rgba(255, 207, 133, 0.1)',
    borderRadius: 2,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  
  PostTagText: {
    fontSize: 7,
    fontWeight: '700' as const,
    color: '#FFCF85',
  },
  
  // Discount Badge
  DiscountBadge: {
    backgroundColor: 'rgba(157, 240, 162, 0.15)',
    borderRadius: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  
  DiscountBadgeText: {
    fontSize: 8,
    fontWeight: '700' as const,
    color: '#9DF0A2',
  },
  
  // Colors
  Colors: {
    Black: '#000000',
    White: '#FFFFFF',
    DarkBg: '#0A0A0A',
    GreenAccent: '#9DF0A2',
    BlueAccent: '#A7D5FF',
    OrangeAccent: '#FFCF85',
    RedAccent: '#FF9B9B',
    BorderGray: '#2A3A4F',
    TextGray: '#D9E6F8',
    SubtleGray: '#8FA0B8',
  },
};
