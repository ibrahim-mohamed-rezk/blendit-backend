import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class AppendOrderNoteDto {
  @ApiProperty({ description: 'Appended to existing order notes (after a blank line)' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  append_note!: string;
}
