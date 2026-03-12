export class AssetDeletedEvent {
  constructor(
    public readonly assetId: string,
    public readonly assetName: string,
    public readonly performedBy: string,
    public readonly serialNumber: string,
    public readonly timestamp: Date = new Date(),
  ) {}
}
